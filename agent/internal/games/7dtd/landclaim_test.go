package sevendtd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mastermind/agent/internal/agent"
)

func TestUpsertLandClaimXMLCreatesFile(t *testing.T) {
	xml := upsertLandClaimXML("", []string{"EOS_abc", "Steam_7656"}, "Pat", 5)
	if !strings.Contains(xml, `Limit="5"`) || !strings.Contains(xml, `<Player`) {
		t.Fatalf("unexpected xml: %s", xml)
	}
}

func TestUpsertLandClaimXMLUpdatesExisting(t *testing.T) {
	raw := `<?xml version="1.0" encoding="UTF-8"?>
<LandClaim>
    <Player Id="EOS_abc" Name="Pat" Limit="1" />
</LandClaim>
`
	xml := upsertLandClaimXML(raw, []string{"EOS_abc"}, "Pat", 4)
	if !strings.Contains(xml, `Limit="4"`) || strings.Contains(xml, `Limit="1"`) {
		t.Fatalf("unexpected xml: %s", xml)
	}
}

func TestUpsertLandClaimXMLInsertsPlayer(t *testing.T) {
	raw := `<?xml version="1.0" encoding="UTF-8"?>
<LandClaim>
</LandClaim>
`
	xml := upsertLandClaimXML(raw, []string{"EOS_abc"}, "Pat", 3)
	if !strings.Contains(xml, `Id="EOS_abc"`) || !strings.Contains(xml, `Limit="3"`) {
		t.Fatalf("unexpected xml: %s", xml)
	}
}

func TestLandClaimIDsIncludePrefixes(t *testing.T) {
	ids := landClaimIDs("7656119", "abc")
	joined := strings.Join(ids, ",")
	if !strings.Contains(joined, "Steam_7656119") || !strings.Contains(joined, "EOS_abc") {
		t.Fatalf("ids=%v", ids)
	}
}

func TestUpsertLandClaimXMLDoesNotDuplicateSamePlayer(t *testing.T) {
	raw := `<?xml version="1.0" encoding="UTF-8"?>
<LandClaimCount>
    <Player Id="EOS_abc" SteamId="Steam_7656" Name="Pat" Limit="1" />
    <Player Id="EOS_abc" SteamId="Steam_7656" Name="Pat" Limit="1" />
</LandClaimCount>
`
	xml := upsertLandClaimXML(raw, []string{"EOS_abc", "Steam_7656"}, "Pat", 1)
	if strings.Count(strings.ToLower(xml), `id="eos_abc"`) != 1 {
		t.Fatalf("expected one EOS row, got: %s", xml)
	}
	if strings.Count(strings.ToLower(xml), `id="steam_7656"`) != 1 {
		t.Fatalf("expected one Steam row, got: %s", xml)
	}
	if strings.Contains(xml, "SteamId=") {
		t.Fatalf("servertools ignores SteamId attributes: %s", xml)
	}
}

func TestUpsertLandClaimXMLUpdatesWithoutInserting(t *testing.T) {
	raw := `<?xml version="1.0" encoding="UTF-8"?>
<LandClaimCount>
    <Player Id="EOS_abc" Name="Pat" Limit="3" />
</LandClaimCount>
`
	xml := upsertLandClaimXML(raw, []string{"EOS_abc"}, "Pat", 3)
	if strings.Count(xml, "<Player") != 1 {
		t.Fatalf("same limit should not insert a duplicate: %s", xml)
	}
}

func TestTriggerNoticeUsesSayPlayerByNameWhenNoEntity(t *testing.T) {
	commands := triggerNoticeCommands(map[string]interface{}{"name": "Pat Two"}, "You can now place 6 land claims.")
	if len(commands) != 1 || commands[0] != `sayplayer "Pat Two" "You can now place 6 land claims."` {
		t.Fatalf("commands=%v", commands)
	}
}

func TestTriggerNoticeUsesSayPlayerByEntity(t *testing.T) {
	commands := triggerNoticeCommands(map[string]interface{}{"name": "Pat Two", "entityId": float64(171)}, "Reward granted.")
	if len(commands) != 1 || commands[0] != `sayplayer 171 "Reward granted."` {
		t.Fatalf("commands=%v", commands)
	}
}

func TestLandClaimNotifyCommandIsPrivateSayPlayer(t *testing.T) {
	command := landClaimNotifyCommand(map[string]interface{}{"name": "Pat Two", "entityId": float64(171)}, "Hello there")
	if command != `sayplayer 171 "Hello there"` {
		t.Fatalf("command=%q", command)
	}
}

func TestReadServerLandClaimDefault(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "serverconfig.xml")
	if err := os.WriteFile(configPath, []byte(`<ServerSettings><property name="LandClaimCount" value="4"/></ServerSettings>`), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := &agent.InstanceConfig{InstallPath: filepath.Join(dir, "7DaysToDieServer.x86_64")}
	got, err := readServerLandClaimDefault(cfg, map[string]interface{}{"server_config_path": configPath})
	if err != nil || got != 4 {
		t.Fatalf("got=%d err=%v", got, err)
	}
}

func TestLandClaimBonusClaimsPrefersBonusClaimsKey(t *testing.T) {
	got, err := landClaimBonusClaims(map[string]interface{}{"bonusClaims": float64(2), "claimCount": float64(9)})
	if err != nil || got != 2 {
		t.Fatalf("got=%d err=%v", got, err)
	}
}

func TestLandClaimBonusClaimsLegacyClaimCount(t *testing.T) {
	got, err := landClaimBonusClaims(map[string]interface{}{"claimCount": float64(1)})
	if err != nil || got != 1 {
		t.Fatalf("got=%d err=%v", got, err)
	}
}
