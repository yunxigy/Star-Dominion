from __future__ import annotations

import socket

import pytest

from webmaster_inspector.policy import TargetBlockedError, validate_redirect, validate_target


def public_answers(*addresses: str):
    return [(socket.AF_INET6 if ':' in address else socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443, 0, 0) if ':' in address else (address, 443)) for address in addresses]


def test_blocks_private_and_literal_targets(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, **kwargs: public_answers('127.0.0.1'))
    with pytest.raises(TargetBlockedError): validate_target('http://localhost')
    with pytest.raises(TargetBlockedError): validate_target('http://127.0.0.1')


def test_accepts_idna_and_validates_port(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, **kwargs: public_answers('93.184.216.34'))
    target = validate_target('https://例子.测试/path?q=1')
    assert target.host.startswith('xn--')
    assert target.path == '/path?q=1'
    with pytest.raises(TargetBlockedError): validate_target('https://example.com:8443')


def test_redirect_is_relative_and_rechecked(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, **kwargs: public_answers('93.184.216.34'))
    destination, target = validate_redirect('https://example.com/a', '/next', resolver=socket.getaddrinfo)
    assert destination == 'https://example.com/next'
    assert target.host == 'example.com'
    with pytest.raises(TargetBlockedError): validate_redirect('https://example.com/a', 'http://example.com/next', resolver=socket.getaddrinfo)
