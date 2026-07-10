"""Tests for PII redactor."""

from __future__ import annotations


from app.utils.pii_redactor import PIIRedactor


def make_redactor(entities=None):
    return PIIRedactor(enabled=True, entities=entities or ["EMAIL", "PHONE", "SSN", "CREDIT_CARD", "IP", "ZIP"])


class TestRedact:
    def test_redact_email(self):
        r = make_redactor(["EMAIL"])
        assert r.redact("Contact me at test@example.com") == "Contact me at [EMAIL]"

    def test_redact_phone(self):
        r = make_redactor(["PHONE"])
        assert r.redact("Call 555-123-4567") == "Call [PHONE]"

    def test_redact_ssn(self):
        r = make_redactor(["SSN"])
        assert r.redact("SSN: 123-45-6789") == "SSN: [SSN]"

    def test_redact_credit_card(self):
        r = make_redactor(["CREDIT_CARD"])
        assert r.redact("Card: 4111-1111-1111-1111") == "Card: [CARD]"

    def test_redact_ip(self):
        r = make_redactor(["IP"])
        assert r.redact("IP: 192.168.1.1") == "IP: [IP]"

    def test_redact_zip(self):
        r = make_redactor(["ZIP"])
        assert r.redact("ZIP: 90210") == "ZIP: [ZIP]"

    def test_redact_multiple_entities(self):
        r = make_redactor()
        result = r.redact("Email: user@test.com, Phone: 555-123-4567")
        assert "[EMAIL]" in result
        assert "[PHONE]" in result

    def test_redact_disabled(self):
        r = PIIRedactor(enabled=False)
        text = "Email: test@test.com"
        assert r.redact(text) == text

    def test_redact_empty_string(self):
        r = make_redactor()
        assert r.redact("") == ""

    def test_redact_no_match(self):
        r = make_redactor()
        assert r.redact("Hello world") == "Hello world"

    def test_redact_selective_entity(self):
        r = make_redactor(["EMAIL"])
        text = "Email: a@b.com, Phone: 555-123-4567"
        result = r.redact(text)
        assert "[EMAIL]" in result
        assert "555-123-4567" in result  # phone not redacted


class TestContainsPII:
    def test_contains_email(self):
        r = make_redactor(["EMAIL"])
        assert r.contains_pii("Send to a@b.com")

    def test_not_contains_pii(self):
        r = make_redactor()
        assert not r.contains_pii("Hello world")

    def test_contains_empty(self):
        r = make_redactor()
        assert not r.contains_pii("")


class TestGetDetectedEntities:
    def test_detects_email(self):
        r = make_redactor(["EMAIL"])
        entities = r.get_detected_entities("Email: a@b.com")
        assert len(entities) == 1
        assert entities[0]["entity"] == "EMAIL"
        assert "start" in entities[0]
        assert "end" in entities[0]

    def test_detects_multiple(self):
        r = make_redactor()
        entities = r.get_detected_entities("Email: a@b.com, Phone: 555-123-4567")
        assert len(entities) == 2
        assert entities[0]["entity"] == "EMAIL"
        assert entities[1]["entity"] == "PHONE"

    def test_no_detections(self):
        r = make_redactor()
        assert r.get_detected_entities("") == []


class TestSingleton:
    def test_singleton_importable(self):
        from app.utils.pii_redactor import pii_redactor
        assert pii_redactor is not None

    def test_singleton_has_redact(self):
        from app.utils.pii_redactor import pii_redactor
        assert hasattr(pii_redactor, "redact")
