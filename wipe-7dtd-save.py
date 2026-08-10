#!/usr/bin/env python3
"""Delete only the save resolved from a 7DTD serverconfig.xml."""
import os
import shutil
import sys
import xml.etree.ElementTree as ET

if len(sys.argv) != 3:
    raise SystemExit("usage: wipe-7dtd-save.py SERVER_CONFIG EXPECTED_SAVE")

config_path = os.path.realpath(sys.argv[1])
requested = os.path.abspath(sys.argv[2])
properties = {
    node.attrib.get("name", ""): node.attrib.get("value", "").strip()
    for node in ET.parse(config_path).getroot().findall("property")
}
world = properties.get("GameWorld", "")
game = properties.get("GameName", "")
user_data = properties.get("UserDataFolder", "") or os.path.join(os.path.dirname(config_path), "userdata")
if not world or not game or os.path.basename(world) != world or os.path.basename(game) != game:
    raise SystemExit("unsafe GameWorld or GameName")

saves_root = os.path.realpath(os.path.join(user_data, "Saves"))
resolved = os.path.abspath(os.path.join(saves_root, world, game))
if os.path.commonpath((saves_root, resolved)) != saves_root or resolved == saves_root:
    raise SystemExit("resolved save is outside Saves")
if requested != resolved:
    raise SystemExit("requested save does not match server configuration")
if os.path.islink(resolved):
    raise SystemExit("save path must not be a symlink")
if not os.path.isdir(resolved):
    raise SystemExit("configured save directory does not exist")

shutil.rmtree(resolved)
if os.path.exists(resolved):
    raise SystemExit("save directory still exists after deletion")
