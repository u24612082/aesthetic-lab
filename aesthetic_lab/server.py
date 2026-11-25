import ipaddress
import os
import socket
import asyncio
import signal
from contextlib import contextmanager

import uvicorn

from .config import token
from .phone import private_address


class ManagedServer(uvicorn.Server):
    @contextmanager
    def capture_signals(self):yield


async def serve_with_phone(config,sockets):
    """One application/worker; preserve desktop HTTP and add a private HTTPS listener."""
    main=ManagedServer(config);main_task=asyncio.create_task(main.serve(sockets=sockets))
    stop=asyncio.Event();phone=None;phone_task=None;phone_socket=None;bound=None
    def shutdown():
        stop.set();main.should_exit=True
        if phone:phone.should_exit=True
    loop=asyncio.get_running_loop()
    for sig in (signal.SIGINT,signal.SIGTERM):
        try:loop.add_signal_handler(sig,shutdown)
        except NotImplementedError:signal.signal(sig,lambda *_:loop.call_soon_threadsafe(shutdown))  # Windows
    try:
        while not main_task.done() and not stop.is_set():
            address=private_address(os.getenv('APP_PHONE_INTERFACE',''))
            if address!=bound or (phone_task and phone_task.done()):
                if phone:
                    phone.should_exit=True
                    if phone_task:await phone_task
                if phone_socket:phone_socket.close()
                phone=phone_task=phone_socket=None;bound=None
                if address:
                    try:
                        phone_socket=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
                        phone_socket.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                        phone_socket.bind((address,int(os.getenv('APP_PHONE_PORT','8443'))))
                        phone_socket.listen(128);phone_socket.setblocking(False)
                        secure=uvicorn.Config('aesthetic_lab.app:app',ssl_certfile=os.environ['APP_PHONE_TLS_CERT'],
                            ssl_keyfile=os.environ['APP_PHONE_TLS_KEY'],proxy_headers=False,access_log=False,log_level='info',lifespan='off')
                        secure.load()
                        phone=ManagedServer(secure);phone_task=asyncio.create_task(phone.serve(sockets=[phone_socket]));bound=address
                        print(f'iPhone HTTPS: https://{os.getenv("APP_PHONE_HOST")}:{os.getenv("APP_PHONE_PORT","8443")}',flush=True)
                    except (OSError,KeyError):
                        if phone_socket:phone_socket.close()
                        phone=phone_task=phone_socket=None
                        print('iPhone network listener unavailable; desktop access remains online.',flush=True)
            try:await asyncio.wait_for(stop.wait(),timeout=10)
            except asyncio.TimeoutError:pass
    finally:
        shutdown()
        await main_task
        if phone_task:await phone_task
        if phone_socket:phone_socket.close()


def validated_binds():
    addresses = list(dict.fromkeys(os.getenv("APP_BIND", "127.0.0.1").split(",")))
    cert, key = os.getenv("APP_TLS_CERT"), os.getenv("APP_TLS_KEY")
    if bool(cert) != bool(key):
        raise ValueError("Both APP_TLS_CERT and APP_TLS_KEY are required")
    for address in addresses:
        ip = ipaddress.ip_address(address.strip())
        allowed_lan = ip.version == 4 and any(ip in ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
        if not ip.is_loopback and not allowed_lan:
            raise ValueError("Bind only to loopback or an explicit RFC1918 LAN interface; wildcard/public binds are refused")
        if not ip.is_loopback and not (cert and key):
            raise ValueError("LAN access requires trusted HTTPS. See docs/network.md")
    return [a.strip() for a in addresses], cert, key


def main():
    token()
    if os.getenv("APP_DEMO", "false").lower() == "true":
        os.environ.update(APP_INBOX="", AUTO_COACH="false", ANTHROPIC_API_KEY="")
    addresses, cert, key = validated_binds()
    port = int(os.getenv("APP_PORT", "8765"))
    sockets = []
    try:
        for address in addresses:
            sock = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((address, port))
            sock.listen(128)
            sock.setblocking(False)
            sockets.append(sock)
            print(f"Aesthetic Lab: {'https' if cert else 'http'}://{address if ':' not in address else '['+address+']'}:{port}", flush=True)
        # One process, multiple explicit interfaces, one database and one background worker.
        config = uvicorn.Config("aesthetic_lab.app:app", ssl_certfile=cert or None, ssl_keyfile=key or None,
                                proxy_headers=False, access_log=False, log_level="info")
        if os.getenv('APP_PHONE_INTERFACE') and os.getenv('APP_PHONE_TLS_CERT') and os.getenv('APP_PHONE_TLS_KEY'):
            asyncio.run(serve_with_phone(config,sockets))
        else:uvicorn.Server(config).run(sockets=sockets)
    finally:
        for sock in sockets:
            sock.close()


if __name__ == "__main__":
    main()
