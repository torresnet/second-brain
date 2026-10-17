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


if __name__ == "__main__":
    unittest.main()
