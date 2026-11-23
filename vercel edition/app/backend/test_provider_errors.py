from __future__ import annotations

import unittest

from provider_errors import provider_http_error


class ProviderErrorTests(unittest.TestCase):
    def test_payment_error_explains_provider_balance_without_leaking_details(self):
        status, message = provider_http_error(402, "Kimi")

        self.assertEqual(status, 402)
        self.assertIn("Kimi", message)
        self.assertIn("رصيدًا أو اشتراكًا", message)

    def test_authentication_and_rate_limit_errors_are_actionable(self):
        auth_status, auth_message = provider_http_error(401, "Gemini")
        limit_status, limit_message = provider_http_error(429, "Gemini")

        self.assertEqual(auth_status, 502)
        self.assertIn("مفتاح الاتصال", auth_message)
        self.assertEqual(limit_status, 429)
        self.assertIn("حدّ الاستخدام", limit_message)

    def test_temporary_provider_outage_recommends_retry_or_another_provider(self):
        status, message = provider_http_error(503, "Gemini")

        self.assertEqual(status, 503)
        self.assertIn("غير متاح مؤقتًا", message)
        self.assertIn("اختر مزوّدًا آخر", message)


if __name__ == "__main__":
    unittest.main()
