#!/usr/bin/env python3
"""Assign only the configured 7DTD live save to the game service account."""
import grp
import os
import pwd
import sys
import xml.etree.ElementTree as ET

if len(sys.argv) != 3:
    raise SystemExit("usage: fix-7dtd-save-permissions.py SERVER_CONFIG EXPECTED_SAVE")

config_path = os.path.realpath(sys.argv[1])
requested = os.path.abspath(sys.argv[2])
properties = {
    node.attrib.get("name", ""): node.attrib.get("value", "").strip()
    for node in ET.parse(config_path).getroot().findall("property")
}
world, game = properties.get("GameWorld", ""), properties.get("GameName", "")
user_data = properties.get("UserDataFolder", "") or os.path.join(os.path.dirname(config_path), "userdata")
if not world or not game or os.path.basename(world) != world or os.path.basename(game) != game:
    raise SystemExit("unsafe GameWorld or GameName")
resolved = os.path.abspath(os.path.join(os.path.realpath(os.path.join(user_data, "Saves")), world, game))
if requested != resolved or os.path.islink(resolved) or not os.path.isdir(resolved):
    raise SystemExit("requested path is not the configured live save")

uid = pwd.getpwnam("serveradmin").pw_uid
gid = grp.getgrnam("serveradmin").gr_gid
for root, directories, files in os.walk(resolved, topdown=False, followlinks=False):
    for name in files:
        path = os.path.join(root, name)
        if os.path.islink(path):
            raise SystemExit("save contains a symbolic link")
        os.chown(path, uid, gid)
        os.chmod(path, os.stat(path).st_mode | 0o660)
    for name in directories:
        path = os.path.join(root, name)
        if os.path.islink(path):
            raise SystemExit("save contains a symbolic link")
        os.chown(path, uid, gid)
        os.chmod(path, os.stat(path).st_mode | 0o770)
os.chown(resolved, uid, gid)
os.chmod(resolved, os.stat(resolved).st_mode | 0o770)
