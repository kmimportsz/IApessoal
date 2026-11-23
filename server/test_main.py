import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from main import Gateway, Rejected, ThreadingHTTPServer, handler


class GatewayTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.file = Path(temporary.name) / "test.sqlite3"
        self.observed = []
        self.token = "owner-" + "x" * 32
        self.config = {"OWNER_TOKEN": self.token, "MONTHLY_LIMIT_CENTS": "20",
                       "OPENAI_MAX_CALL_CENTS": "10", "OPENAI_API_KEY": "test",
                       "ENABLE_PAID": "yes", "OLLAMA_URL": "http://127.0.0.1:11434"}
        self.gateway = Gateway(self.file, self.config, self.adapter)

    def adapter(self, url, data, key=None):
        self.observed.append((url, data, key))
        if key:
            return {"choices": [{"message": {"content": "Resposta de teste"}}],
                    "usage": {"prompt_tokens": 21, "completion_tokens": 5}}
        return {"message": {"content": "Resposta local de teste"}}

    def job(self, route="paid"):
        return {"id": str(uuid4()), "route": route, "prompt": "Como está o orçamento?"}

    def test_disabled_by_default(self):
        self.config.pop("ENABLE_PAID")
        gateway = Gateway(self.file, self.config, self.adapter)
        with self.assertRaises(Rejected) as error:
            gateway.chat(self.job())
        self.assertEqual(error.exception.status, 503)
        self.assertEqual(self.observed, [])

    def test_paid_reservation_is_atomic(self):
        def perform(job):
            try:
                self.gateway.chat(job)
                return 200
            except Rejected as error:
                return error.status

        with ThreadPoolExecutor(max_workers=8) as workers:
            statuses = list(workers.map(perform, [self.job() for _ in range(8)]))
        self.assertEqual(statuses.count(200), 2)
        self.assertEqual(statuses.count(402), 6)
        self.assertEqual(len(self.observed), 2)
        self.assertEqual(self.gateway.status()["reserved"], 20)
        self.assertEqual(self.gateway.status()["inputTokens"], 42)
        self.assertEqual(self.gateway.status()["outputTokens"], 10)

    def test_dedup_survives_restart_and_local_is_free(self):
        job = self.job()
        self.gateway.chat(job)
        gateway = Gateway(self.file, self.config, self.adapter)
        with self.assertRaises(Rejected) as error:
            gateway.chat(job)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(gateway.chat(self.job("local"))["route"], "local")
        self.assertEqual(gateway.status()["reserved"], 10)
        self.assertIsNone(self.observed[-1][2])

    def test_unknown_provider_response_keeps_reservation(self):
        gateway = Gateway(self.file, self.config, lambda *_: {})
        with self.assertRaises(Rejected) as error:
            gateway.chat(self.job())
        self.assertEqual(error.exception.status, 502)
        self.assertEqual(gateway.status()["reserved"], 10)
        self.assertEqual(gateway.audit()[0]["state"], "uncertain")

    def test_http_auth_chat_and_audit(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), handler(self.gateway)) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{server.server_port}"
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + "/status", timeout=3)
                self.assertEqual(error.exception.code, 401)
                headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
                with urlopen(Request(base + "/chat", json.dumps(self.job("local")).encode(),
                                     headers), timeout=3) as response:
                    self.assertEqual(json.load(response)["reply"], "Resposta local de teste")
                with urlopen(Request(base + "/audit", headers=headers), timeout=3) as response:
                    self.assertEqual(json.load(response)[0]["state"], "finished")
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()
