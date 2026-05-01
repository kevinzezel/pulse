"""
Smoke tests for tools/network.py.

Run from `client/src/`:

    python3 -m unittest tools.test_network

The default-route + hostname collectors are stdlib-based and may behave
differently per environment, so these tests focus on the deterministic edges
(loopback always matches, explicit local-IP injection matches, foreign IP does
not, malformed input does not raise).
"""
import unittest

from tools import network


class IsSameServerPeerTest(unittest.TestCase):
    def test_loopback_peer_is_same_server(self):
        # `127.0.0.1` and `::1` are the canonical loopback peers FastAPI/uvicorn
        # surface for browsers/Pulse-CLI hitting the client over localhost. They
        # must always resolve to True regardless of what the host's interfaces
        # currently look like (VPN, docker, no network, etc.).
        self.assertTrue(network.is_same_server_peer("127.0.0.1", local_ips=set()))
        self.assertTrue(network.is_same_server_peer("::1", local_ips=set()))
        self.assertTrue(network.is_same_server_peer("127.0.0.5", local_ips=set()))

    def test_ipv4_mapped_v6_loopback(self):
        # When the listener is dual-stack, an IPv4 client may surface as
        # `::ffff:127.0.0.1`. The helper unwraps that and treats it as loopback.
        self.assertTrue(
            network.is_same_server_peer("::ffff:127.0.0.1", local_ips=set())
        )

    def test_lan_peer_matching_local_ip(self):
        # Browser on a LAN host hitting the client by LAN IP: peer.host equals
        # one of the host's interface IPs. The injected `local_ips` exercises
        # the matching path without depending on the test machine's actual NICs.
        self.assertTrue(
            network.is_same_server_peer(
                "192.168.0.130", local_ips={"192.168.0.130", "10.0.0.5"}
            )
        )

    def test_local_ips_are_normalized_before_matching(self):
        self.assertTrue(
            network.is_same_server_peer(
                "fe80::1", local_ips={"fe80::1%eth0/64"}
            )
        )

    def test_ipv4_mapped_v6_peer_matches_local_ipv4(self):
        self.assertTrue(
            network.is_same_server_peer(
                "::ffff:192.168.0.130", local_ips={"192.168.0.130"}
            )
        )

    def test_foreign_peer_is_not_same_server(self):
        self.assertFalse(
            network.is_same_server_peer(
                "203.0.113.42", local_ips={"192.168.0.130"}
            )
        )

    def test_empty_or_invalid_peer_returns_false(self):
        self.assertFalse(network.is_same_server_peer(None, local_ips=set()))
        self.assertFalse(network.is_same_server_peer("", local_ips=set()))
        self.assertFalse(network.is_same_server_peer("not-an-ip", local_ips=set()))


if __name__ == "__main__":
    unittest.main()
