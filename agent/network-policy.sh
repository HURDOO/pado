#!/bin/sh
set -eu
# Runs in a disposable, trusted NET_ADMIN helper sharing only the new container's network
# namespace. No workspace, authentication or host mounts are present in this helper.
iptables -w -P OUTPUT DROP
ip6tables -w -P OUTPUT DROP
iptables -w -A OUTPUT -o lo -j ACCEPT
iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Permit only DNS to the resolver provisioned by Docker, even if it is on a private range.
for resolver in $(awk '$1 == "nameserver" && $2 ~ /^[0-9.]+$/ {print $2}' /etc/resolv.conf); do
  iptables -w -A OUTPUT -d "$resolver" -p udp --dport 53 -j ACCEPT
  iptables -w -A OUTPUT -d "$resolver" -p tcp --dport 53 -j ACCEPT
done
# Refuse host/LAN, link-local metadata, CGNAT, multicast and other non-global destinations.
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -w -A OUTPUT -d "$cidr" -j REJECT
done
# The dedicated Docker network resolves DNS locally; public HTTPS/HTTP supports CLI and builds.
iptables -w -A OUTPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
ip6tables -w -A OUTPUT -o lo -j ACCEPT
ip6tables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
