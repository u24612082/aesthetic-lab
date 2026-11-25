#!/usr/bin/env python3
"""Create a private local HTTPS identity without changing Mac system trust or the Mac URL."""
import argparse
import ipaddress
import os
import plistlib
import subprocess
import sys
import uuid
from datetime import datetime,timedelta,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from aesthetic_lab.phone import private_address
from aesthetic_lab.coaching import save_settings


def generate(directory,hostname,address):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    now=datetime.now(timezone.utc)
    ca_file=directory/'phone-ca.pem';key_file=directory/'phone-ca-key.pem'
    if ca_file.exists() and key_file.exists():
        ca=x509.load_pem_x509_certificate(ca_file.read_bytes())
        ca_key=serialization.load_pem_private_key(key_file.read_bytes(),password=None)
    else:
        ca_key=ec.generate_private_key(ec.SECP256R1())
        subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Aesthetic Lab Personal Mac CA')])
        ca=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
            .add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),False).sign(ca_key,hashes.SHA256()))
        ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
        key_file.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    key=ec.generate_private_key(ec.SECP256R1())
    sans=[x509.DNSName(hostname),x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1')),x509.IPAddress(ipaddress.ip_address(address))]
    certificate=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,hostname)]))
        .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(sans),False)
        .add_extension(x509.BasicConstraints(ca=False,path_length=None),True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),False)
        .add_extension(x509.KeyUsage(True,False,False,False,False,False,False,False,False),True)
        .sign(ca_key,hashes.SHA256()))
    (directory/'phone-server.pem').write_bytes(certificate.public_bytes(serialization.Encoding.PEM)+ca.public_bytes(serialization.Encoding.PEM))
    (directory/'phone-server-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    identity='local.aesthetic-lab.'+hashlib_id(ca.fingerprint(hashes.SHA256()))
    profile={'PayloadType':'Configuration','PayloadVersion':1,'PayloadIdentifier':identity,'PayloadUUID':str(uuid.uuid4()),
             'PayloadDisplayName':'Aesthetic Lab — My Mac','PayloadDescription':'Trust your personal Mac server for Aesthetic Lab on your private network.',
             'PayloadRemovalDisallowed':False,'PayloadContent':[{'PayloadType':'com.apple.security.root','PayloadVersion':1,
                'PayloadIdentifier':identity+'.root','PayloadUUID':str(uuid.uuid4()),'PayloadDisplayName':'Aesthetic Lab Personal Mac CA',
                'PayloadCertificateFileName':'aesthetic-lab-ca.cer','PayloadContent':ca.public_bytes(serialization.Encoding.DER)}]}
    (directory/'iphone.mobileconfig').write_bytes(plistlib.dumps(profile))
    for path in directory.iterdir():
        if path.is_file():path.chmod(0o600)
    return ca.fingerprint(hashes.SHA256()).hex()


def hashlib_id(value):return value.hex()[:24]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--interface',default='en0');args=parser.parse_args()
    address=private_address(args.interface)
    if not address:raise SystemExit('Connect the Mac to your private Wi-Fi, then run setup again.')
    hostname=subprocess.run(['/usr/sbin/scutil','--get','LocalHostName'],capture_output=True,text=True,check=True).stdout.strip()+'.local'
    fingerprint=generate(ROOT/'certs',hostname,address)
    hosts=set(os.getenv('APP_HOSTS','localhost,127.0.0.1').split(','));hosts.update((hostname,address))
    save_settings({'APP_PHONE_INTERFACE':args.interface,'APP_PHONE_HOST':hostname,'APP_PHONE_PORT':'8443',
                   'APP_PHONE_TLS_CERT':str(ROOT/'certs/phone-server.pem'),'APP_PHONE_TLS_KEY':str(ROOT/'certs/phone-server-key.pem'),
                   'APP_HOSTS':','.join(sorted(hosts))})
    print(f'Phone HTTPS prepared: https://{hostname}:8443/')
    print('Public profile for AirDrop: certs/iphone.mobileconfig')
    print('CA SHA-256:',fingerprint)
    print('Only transfer iphone.mobileconfig; private keys stay on your Mac. Restart the Mac service to activate.')


if __name__=='__main__':main()
