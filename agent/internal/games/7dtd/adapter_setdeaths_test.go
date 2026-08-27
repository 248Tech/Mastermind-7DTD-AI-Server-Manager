package sevendtd

import "testing"

func TestSetDeathsCommand(t *testing.T) {
	got, err := setDeathsCommand("Steam_76561198000000000", 3)
	if err != nil {
		t.Fatal(err)
	}
	if got != "st-SetPlayerDeaths Steam_76561198000000000 3" {
		t.Fatalf("got %q", got)
	}
	ids := setDeathsIdentifiers(map[string]interface{}{"identifier": "171", "platform": "Steam", "steamId": "76561198000000000"})
	if len(ids) == 0 || ids[0] != "171" {
		t.Fatalf("numeric entity ids must stay unprefixed, got %#v", ids)
	}
	if !containsString(ids, "Steam_76561198000000000") {
		t.Fatalf("steam id missing from %#v", ids)
	}
	if _, err := setDeathsCommand("", 1); err == nil {
		t.Fatal("empty identifier should fail")
	}
	if _, err := setDeathsCommand("Ada", -1); err == nil {
		t.Fatal("negative deaths should fail")
	}
	if _, err := setDeathsCommand("Ada Two", 1); err == nil {
		t.Fatal("spaced identifier should fail")
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
