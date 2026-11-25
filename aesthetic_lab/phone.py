"""Private network discovery, short-lived pairing, and public certificate-profile helpers."""
import hashlib
import hmac
import io
import ipaddress
import os
import secrets
import subprocess
import time
from pathlib import Path

from .config import ROOT,token
from .db import connect


def private_address(interface):
    if not interface or not interface.replace('_','').isalnum():return None
    try:
        result=subprocess.run(['/usr/sbin/ipconfig','getifaddr',interface],capture_output=True,text=True,timeout=3)
        address=result.stdout.strip()
        ip=ipaddress.ip_address(address)
        if ip.version==4 and any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):return address
    except (OSError,ValueError,subprocess.TimeoutExpired):pass
    return None


def settings():
    interface=os.getenv('APP_PHONE_INTERFACE','')
    hostname=os.getenv('APP_PHONE_HOST','')
    enabled=bool(interface and hostname and os.getenv('APP_PHONE_TLS_CERT') and os.getenv('APP_PHONE_TLS_KEY'))
    address=private_address(interface) if enabled else None
    port=int(os.getenv('APP_PHONE_PORT','8443'))
    return {'enabled':enabled,'address':address,'hostname':hostname,'port':port,
            'url':f'https://{hostname}:{port}/' if enabled else None,
            'profile_available':(ROOT/'certs/iphone.mobileconfig').exists(),
            'same_wifi_required':True,'mac_must_be_awake':True}


def pairing_digest(code):
    return hmac.new(token().encode(),('phone-pair:'+code).encode(),hashlib.sha256).hexdigest()


def create_pairing_code():
    code=f'{secrets.randbelow(1000000):06d}'
    expires=time.time()+300
    with connect() as c:c.execute('INSERT OR REPLACE INTO device_pairing(id,code_hash,expires_at) VALUES(1,?,?)',(pairing_digest(code),expires))
    return {'code':code,'expires_at':expires}


def consume_pairing_code(code):
    if len(code)!=6 or not code.isascii() or not code.isdigit():return False
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT * FROM device_pairing WHERE id=1').fetchone()
        if not row or row['expires_at']<time.time() or not hmac.compare_digest(row['code_hash'],pairing_digest(code)):return False
        c.execute('DELETE FROM device_pairing WHERE id=1')
    return True


def qr_svg(url):
    import qrcode
    from qrcode.image.svg import SvgPathImage
    stream=io.BytesIO()
    qrcode.make(url,image_factory=SvgPathImage,box_size=8,border=3).save(stream)
    return stream.getvalue()
