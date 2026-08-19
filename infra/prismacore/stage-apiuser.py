#!/usr/bin/env python3
"""Write ClaimCreator_permissions.xml and a local env snippet. Does not print the password."""
from __future__ import annotations

import os
import secrets
import stat

USER = "mastermind"
PERM = "/opt/7dtd/userdata/Saves/ClaimCreator_permissions.xml"
SECRET = "/opt/7dtd/userdata/Saves/.prismacore-apiuser"
URL = "http://10.77.0.2:11111"


def main() -> None:
    os.makedirs(os.path.dirname(PERM), exist_ok=True)
    if os.path.exists(SECRET):
        print("secret already exists; left permissions in place")
        return
    password = secrets.token_urlsafe(24)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<cpmcc_permissions>
	<apiusers>
		<apiuser username="{USER}" password="{password}" permission_level="0" />
	</apiusers>
	<permissions>
		<permission module="ClaimCreator.map" permission_level="0" />
		<permission module="ClaimCreator.createadvclaims" permission_level="0" />
		<permission module="ClaimCreator.getlandclaims" permission_level="0" />
		<permission module="ClaimCreator.getadvclaims" permission_level="0" />
		<permission module="ClaimCreator.getresetregions" permission_level="0" />
		<permission module="ClaimCreator.getplayerhomes" permission_level="0" />
		<permission module="ClaimCreator.getplayersonline" permission_level="0" />
		<permission module="ClaimCreator.getquestpois" permission_level="0" />
		<permission module="ClaimCreator.getallpois" permission_level="0" />
		<permission module="ClaimCreator.gettraders" permission_level="0" />
		<permission module="ClaimCreator.getvehicles" permission_level="0" />
		<permission module="ClaimCreator.getdrones" permission_level="0" />
	</permissions>
</cpmcc_permissions>
"""
    with open(PERM, "w", encoding="utf-8") as handle:
        handle.write(xml)
    with open(SECRET, "w", encoding="utf-8") as handle:
        handle.write(
            f"PRISMACORE_WEB_URL={URL}\nPRISMACORE_API_USER={USER}\nPRISMACORE_API_PASSWORD={password}\n"
        )
    os.chmod(PERM, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
    os.chmod(SECRET, stat.S_IRUSR | stat.S_IWUSR)
    print("wrote ClaimCreator_permissions.xml and .prismacore-apiuser")


if __name__ == "__main__":
    main()
