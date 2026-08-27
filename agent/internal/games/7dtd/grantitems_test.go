package sevendtd

import "testing"

func TestGivePlusCommand(t *testing.T) {
	cmd, err := givePlusCommand("76561198000000000", grantItem{Name: "resourceWood", Quantity: 4, Quality: 0})
	if err != nil {
		t.Fatal(err)
	}
	if cmd != "giveplus Steam_76561198000000000 resourceWood 4" {
		t.Fatalf("command=%q", cmd)
	}
	cmd, err = givePlusCommand("Steam_76561198000000000", grantItem{Name: "gunM60", Quantity: 1, Quality: 6})
	if err != nil {
		t.Fatal(err)
	}
	if cmd != "giveplus Steam_76561198000000000 gunM60 1 6" {
		t.Fatalf("quality command=%q", cmd)
	}
}

func TestGivePlusCommandRejectsAll(t *testing.T) {
	if _, err := givePlusCommand("all", grantItem{Name: "resourceWood", Quantity: 1}); err == nil {
		t.Fatal("expected rejection of giveplus all")
	}
	if _, err := givePlusCommand("76561198000000000", grantItem{Name: "all", Quantity: 1}); err == nil {
		t.Fatal("expected rejection of item all")
	}
}

func TestGrantItemsFromPayload(t *testing.T) {
	items, err := grantItemsFromPayload(map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{"name": "resourceWood", "quantity": float64(3)},
			map[string]interface{}{"name": "gunM60", "quantity": float64(1), "quality": float64(5)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[1].Quality != 5 {
		t.Fatalf("items=%v", items)
	}
}
