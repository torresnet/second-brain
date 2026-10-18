"""Testes da proteção SSRF do media-fetcher. Rodar: python -m unittest media-fetcher/test_server.py"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("FETCHER_API_KEY", "teste")
import server  # noqa: E402


def addrinfo(*ips):
    return lambda *a, **k: [(0, 0, 0, "", (ip, 0)) for ip in ips]


class FakeResponse:
    def __init__(self, status, headers=None):
        self.status = status
        self._headers = headers or {}

    def getheader(self, name, default=None):
        return self._headers.get(name, default)

    def close(self):
        pass


class FakeConnection:
    def __init__(self, response):
        self._response = response

    def request(self, *args, **kwargs):
        pass

    def getresponse(self):
        return self._response

    def close(self):
        pass


class ResolvePublicTests(unittest.TestCase):
    def test_rejeita_enderecos_internos(self):
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"]:
            with mock.patch("socket.getaddrinfo", addrinfo(ip)):
                with self.assertRaises(server.FetchError, msg=ip):
                    server.resolve_public("https://exemplo.com/video.mp4")

    def test_rejeita_quando_qualquer_registro_e_interno(self):
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34", "10.0.0.5")):
            with self.assertRaises(server.FetchError):
                server.resolve_public("https://exemplo.com/")

    def test_rejeita_porta_e_credenciais_e_esquema(self):
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34")):
            for url in ["https://exemplo.com:8080/", "http://u:p@exemplo.com/", "file:///etc/passwd", "ftp://exemplo.com/", "https://exemplo.com:abc/"]:
                with self.assertRaises(server.FetchError, msg=url):
                    server.resolve_public(url)

    def test_aceita_publico_e_devolve_ip_validado(self):
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34")):
            parsed, port, ip = server.resolve_public("https://exemplo.com/a.mp4")
        self.assertEqual((parsed.hostname, port, ip), ("exemplo.com", 443, "93.184.216.34"))


class RedirectTests(unittest.TestCase):
    def test_redirect_para_ip_interno_e_barrado(self):
        resposta = FakeResponse(302, {"Location": "http://169.254.169.254/latest/meta-data"})

        def resolver(host, port, **kw):
            return addrinfo("169.254.169.254" if host == "169.254.169.254" else "93.184.216.34")()

        with mock.patch("socket.getaddrinfo", resolver), mock.patch.object(server, "_connect", return_value=FakeConnection(resposta)):
            with self.assertRaises(server.FetchError):
                server.open_validated("https://exemplo.com/video")

    def test_redirect_para_porta_interna_e_barrado(self):
        resposta = FakeResponse(301, {"Location": "http://exemplo.com:8080/admin"})
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34")), mock.patch.object(server, "_connect", return_value=FakeConnection(resposta)):
            with self.assertRaises(server.FetchError):
                server.open_validated("https://exemplo.com/video")

    def test_redirecionamentos_demais(self):
        resposta = FakeResponse(302, {"Location": "https://exemplo.com/outro"})
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34")), mock.patch.object(server, "_connect", return_value=FakeConnection(resposta)):
            with self.assertRaisesRegex(server.FetchError, "demais"):
                server.open_validated("https://exemplo.com/video")

    def test_resposta_normal_passa(self):
        resposta = FakeResponse(200, {"Content-Type": "video/mp4"})
        with mock.patch("socket.getaddrinfo", addrinfo("93.184.216.34")), mock.patch.object(server, "_connect", return_value=FakeConnection(resposta)):
            _, resp, final = server.open_validated("https://exemplo.com/video")
        self.assertIs(resp, resposta)
        self.assertEqual(final, "https://exemplo.com/video")


class PreflightTests(unittest.TestCase):
    def test_falha_de_conexao_bloqueia_em_vez_de_liberar_para_o_yt_dlp(self):
        with mock.patch.object(server, "open_validated", side_effect=ConnectionResetError()):
            with self.assertRaisesRegex(server.FetchError, "verificar"):
                server.preflight("https://exemplo.com/video")

    def test_destino_interno_continua_bloqueado(self):
        with mock.patch("socket.getaddrinfo", addrinfo("10.0.0.5")):
            with self.assertRaises(server.FetchError):
                server.preflight("https://exemplo.com/video")


class PlataformaConfiavelTests(unittest.TestCase):
    def test_hosts_de_plataformas_e_subdominios(self):
        for url in ["https://www.instagram.com/reel/abc/", "https://vm.tiktok.com/x", "https://youtu.be/abc",
                    "https://m.youtube.com/watch?v=1", "https://x.com/u/status/1", "https://vimeo.com/1"]:
            self.assertTrue(server.is_trusted_media_host(url), url)

    def test_hosts_desconhecidos_ou_parecidos_nao_sao_confiaveis(self):
        for url in ["https://exemplo.com/video.mp4", "https://instagram.com.evil.example/x",
                    "https://evilinstagram.com/x", "http://169.254.169.254/", "nao-e-url"]:
            self.assertFalse(server.is_trusted_media_host(url), url)


class FetchMediaTests(unittest.TestCase):
    def rodar(self, final_url, original="https://link-original.example/a"):
        chamadas = {"ytdlp": [], "direto": []}

        def ytdlp(url, workdir):
            chamadas["ytdlp"].append(url)

        def direto(url, workdir):
            chamadas["direto"].append(url)

        with mock.patch.object(server, "preflight", return_value=final_url), \
                mock.patch.object(server, "download_with_ytdlp", side_effect=ytdlp), \
                mock.patch.object(server, "download_direct", side_effect=direto), \
                mock.patch.object(server, "prepare_files", return_value=([{"mime": "video/mp4", "base64": ""}], [])):
            server.fetch_media(original)
        return chamadas

    def test_link_generico_nunca_passa_pelo_yt_dlp(self):
        chamadas = self.rodar("https://exemplo.com/video.mp4", "https://exemplo.com/v")
        self.assertEqual(chamadas["ytdlp"], [])
        self.assertEqual(chamadas["direto"], ["https://exemplo.com/video.mp4"])

    def test_link_generico_que_redireciona_para_plataforma_nao_usa_yt_dlp(self):
        chamadas = self.rodar("https://www.instagram.com/reel/abc/", "https://site-do-atacante.example/r")
        self.assertEqual(chamadas["ytdlp"], [])

    def test_plataforma_usa_yt_dlp_com_a_url_original(self):
        # o preflight sem login costuma cair na página de login; o extrator precisa do link do Reel
        chamadas = self.rodar("https://www.instagram.com/accounts/login/?next=/reel/abc/",
                              "https://www.instagram.com/reel/abc/")
        self.assertEqual(chamadas["ytdlp"], ["https://www.instagram.com/reel/abc/"])

    def test_link_de_plataforma_que_redireciona_para_fora_nao_usa_yt_dlp(self):
        # ex.: l.instagram.com/?u=... redireciona para um site qualquer
        chamadas = self.rodar("https://site-do-atacante.example/v.mp4", "https://l.instagram.com/?u=x")
        self.assertEqual(chamadas["ytdlp"], [])
        self.assertEqual(chamadas["direto"], ["https://site-do-atacante.example/v.mp4"])

    def test_preflight_devolve_a_url_final_depois_dos_redirects(self):
        resposta = FakeResponse(200, {"Content-Type": "video/mp4"})
        with mock.patch.object(server, "open_validated", return_value=(FakeConnection(resposta), resposta, "https://final.example/v")):
            self.assertEqual(server.preflight("https://inicio.example/"), "https://final.example/v")


class YtDlpComandoTests(unittest.TestCase):
    def test_extrator_generico_desligado(self):
        capturado = {}

        def fake_run(cmd, timeout):
            capturado["cmd"] = cmd
            return mock.Mock(stderr="", stdout="")

        with mock.patch.object(server, "run", side_effect=fake_run), mock.patch("os.listdir", return_value=["01.mp4"]):
            server.download_with_ytdlp("https://www.instagram.com/reel/abc/", "/tmp/x")
        cmd = capturado["cmd"]
        self.assertIn("--use-extractors", cmd)
        self.assertEqual(cmd[cmd.index("--use-extractors") + 1], "default,-generic")
        self.assertEqual(cmd[-1], "https://www.instagram.com/reel/abc/")

    def test_carrossel_de_imagens_baixa_as_fotos(self):
        # Post só de imagens: o yt-dlp acusa "No video formats found" e não grava nada sem estas opções
        capturado = {}

        def fake_run(cmd, timeout):
            capturado["cmd"] = cmd
            return mock.Mock(stderr="", stdout="")

        with mock.patch.object(server, "run", side_effect=fake_run), mock.patch("os.listdir", return_value=["01.jpg"]):
            server.download_with_ytdlp("https://www.instagram.com/p/abc/", "/tmp/x")
        self.assertIn("--ignore-no-formats-error", capturado["cmd"])
        self.assertIn("--write-thumbnail", capturado["cmd"])


class ArquivosDeMidiaTests(unittest.TestCase):
    def test_capa_de_video_e_descartada_e_fotos_do_carrossel_ficam(self):
        nomes = ["01.mp4", "01.jpg", "02.jpg", "03.webp", "03.info.json", "00.info.json"]
        with mock.patch("os.listdir", return_value=nomes):
            self.assertEqual(server.media_names("/tmp/x"), ["01.mp4", "02.jpg", "03.webp"])

    def test_capa_de_audio_tambem_e_descartada(self):
        with mock.patch("os.listdir", return_value=["01.m4a", "01.webp"]):
            self.assertEqual(server.media_names("/tmp/x"), ["01.m4a"])


class CarrosselDeImagensTests(unittest.TestCase):
    def test_carrossel_so_de_fotos_vira_arquivos_para_o_gemini(self):
        import tempfile

        with tempfile.TemporaryDirectory() as workdir:
            for n in range(1, 11):
                with open(os.path.join(workdir, f"{n:02d}.jpg"), "wb") as fh:
                    fh.write(b"\xff\xd8\xff" + bytes([n]) * 1000)
            with open(os.path.join(workdir, "00.info.json"), "w", encoding="utf-8") as fh:
                fh.write('{"title": "Post by alguem", "description": "legenda"}')
            files, notes = server.prepare_files(workdir)
            meta = server.read_metadata(workdir)
        self.assertEqual(len(files), 10)
        self.assertTrue(all(f["mime"] == "image/jpeg" and f["base64"] for f in files))
        self.assertEqual(notes, [])
        self.assertEqual(meta["description"], "legenda")


if __name__ == "__main__":
    unittest.main()
