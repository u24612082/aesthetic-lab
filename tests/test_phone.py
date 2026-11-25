import importlib.util
import plistlib
import time
from pathlib import Path

from fastapi.testclient import TestClient
from aesthetic_lab.app import app,attempts
from aesthetic_lab.db import connect
from aesthetic_lab import phone


def test_pairing_code_is_short_lived_single_use_and_not_stored_plaintext(client):
    attempts.clear()
    created=client.post('/api/phone/pairing-code').json()
    code=created['code']
    assert len(code)==6 and code.isdigit() and created['expires_at']>time.time()
    with connect() as c:assert c.execute('SELECT code_hash FROM device_pairing').fetchone()[0]!=code
    other=TestClient(app,base_url='https://localhost')
    assert other.get('/api/data').status_code==401
    response=other.post('/api/login',json={'token':code})
    assert response.status_code==200 and '; Secure' in response.headers['set-cookie']
    assert other.get('/api/data').status_code==200
    assert TestClient(app,base_url='https://localhost').post('/api/login',json={'token':code}).status_code==401


def test_expired_or_replaced_pairing_codes_are_rejected(client,monkeypatch):
    attempts.clear()
    monkeypatch.setattr(phone.secrets,'randbelow',lambda _:123456)
    first=phone.create_pairing_code()['code']
    monkeypatch.setattr(phone.secrets,'randbelow',lambda _:654321)
    second=phone.create_pairing_code()['code']
    assert not phone.consume_pairing_code(first)
    with connect() as c:c.execute('UPDATE device_pairing SET expires_at=0')
    assert not phone.consume_pairing_code(second)


def test_phone_settings_do_not_expose_private_keys(client,monkeypatch):
    monkeypatch.setenv('APP_PHONE_INTERFACE','en0');monkeypatch.setenv('APP_PHONE_HOST','example.local')
    monkeypatch.setenv('APP_PHONE_TLS_CERT','/private/server.pem');monkeypatch.setenv('APP_PHONE_TLS_KEY','/private/secret-key.pem')
    monkeypatch.setattr(phone,'private_address',lambda _: '192.168.1.50')
    result=client.get('/api/phone/status')
    assert result.json()['url']=='https://example.local:8443/'
    assert 'secret-key' not in result.text
    qr=client.get('/api/phone/qr.svg')
    assert qr.status_code==200 and qr.headers['content-type'].startswith('image/svg+xml')


def test_generated_profile_contains_only_public_root_certificate(tmp_path):
    spec=importlib.util.spec_from_file_location('setup_phone',Path(__file__).parents[1]/'scripts/setup_phone.py')
    setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
    fingerprint=setup.generate(tmp_path,'test-mac.local','192.168.1.50')
    profile=plistlib.loads((tmp_path/'iphone.mobileconfig').read_bytes())
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    ca=x509.load_der_x509_certificate(profile['PayloadContent'][0]['PayloadContent'])
    assert ca.fingerprint(hashes.SHA256()).hex()==fingerprint
    assert b'PRIVATE KEY' not in (tmp_path/'iphone.mobileconfig').read_bytes()
    assert (tmp_path/'phone-ca-key.pem').stat().st_mode&0o777==0o600
    server=x509.load_pem_x509_certificate((tmp_path/'phone-server.pem').read_bytes())
    assert server.extensions.get_extension_for_class(x509.AuthorityKeyIdentifier).value.key_identifier==ca.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value.digest
    assert 'test-mac.local' in server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    assert setup.generate(tmp_path,'test-mac.local','192.168.1.51')==fingerprint
