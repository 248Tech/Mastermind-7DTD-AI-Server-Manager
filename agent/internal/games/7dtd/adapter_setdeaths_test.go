package sevendtd

import "testing"

func TestSetDeathsCommand(t *testing.T) {
	got, err := setDeathsCommand("Steam_76561198000000000", 3)
	if err != nil {
		t.Fatal(err)
	}
	if got != "st-SetDeaths Steam_76561198000000000 3" {
		t.Fatalf("got %q", got)
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
