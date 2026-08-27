package sevendtd

import (
	"context"
	"fmt"
	"strings"

	"github.com/mastermind/agent/internal/agent"
)

type grantItem struct {
	Name     string
	Quantity int
	Quality  int
}

func applyGrantItemsReward(ctx context.Context, adapter *Adapter, cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	steamId := strings.TrimSpace(getString(payload, "steamId", ""))
	items, err := grantItemsFromPayload(payload)
	if err != nil {
		return nil, err
	}
	outputs := make([]string, 0, len(items))
	delivered := make([]string, 0, len(items))
	for _, item := range items {
		command, err := givePlusCommand(steamId, item)
		if err != nil {
			return nil, err
		}
		out, sendErr := adapter.SendCommand(ctx, cfg, command)
		if strings.TrimSpace(out) != "" {
			outputs = append(outputs, out)
		}
		if sendErr != nil {
			return nil, sendErr
		}
		if grantPlayerMissing(out) {
			return nil, fmt.Errorf("player not found: %s", strings.TrimSpace(out))
		}
		if grantItemInvalid(out) {
			return nil, fmt.Errorf("item not found: %s", strings.TrimSpace(out))
		}
		delivered = append(delivered, fmt.Sprintf("%dx %s", item.Quantity, item.Name))
	}
	notified := sendTriggerNotice(ctx, adapter, cfg, payload, getString(payload, "message", "You reached a reward level."))
	return map[string]interface{}{
		"delivered": delivered,
		"output":    strings.Join(outputs, "\n"),
		"notified":  notified,
	}, nil
}

func grantItemsFromPayload(payload map[string]interface{}) ([]grantItem, error) {
	raw, ok := payload["items"].([]interface{})
	if !ok || len(raw) == 0 {
		return nil, fmt.Errorf("at least one grant item is required")
	}
	if len(raw) > 8 {
		return nil, fmt.Errorf("at most 8 grant items are allowed")
	}
	items := make([]grantItem, 0, len(raw))
	for _, row := range raw {
		record, ok := row.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("invalid grant item")
		}
		name := sanitizeGrantItemName(getString(record, "name", ""))
		quantity := getInt(record, "quantity", 1)
		quality := getInt(record, "quality", 0)
		if name == "" || quantity < 1 || quantity > 9999 {
			return nil, fmt.Errorf("invalid grant item")
		}
		if quality < 0 || quality > 6 {
			return nil, fmt.Errorf("grant item quality must be 1-6")
		}
		items = append(items, grantItem{Name: name, Quantity: quantity, Quality: quality})
	}
	return items, nil
}

func givePlusCommand(steamId string, item grantItem) (string, error) {
	target := grantSteamTarget(steamId)
	if target == "" {
		return "", fmt.Errorf("player Steam id is required")
	}
	name := sanitizeGrantItemName(item.Name)
	if name == "" || item.Quantity < 1 || item.Quantity > 9999 {
		return "", fmt.Errorf("invalid grant item")
	}
	command := fmt.Sprintf("giveplus %s %s %d", target, name, item.Quantity)
	if item.Quality >= 1 && item.Quality <= 6 {
		command += fmt.Sprintf(" %d", item.Quality)
	}
	return command, nil
}

func grantSteamTarget(steamId string) string {
	steamId = strings.TrimSpace(steamId)
	if steamId == "" {
		return ""
	}
	id := strings.TrimPrefix(strings.TrimPrefix(steamId, "Steam_"), "steam_")
	if id == "" || strings.EqualFold(id, "all") {
		return ""
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return ""
		}
	}
	if len(id) < 15 || len(id) > 20 {
		return ""
	}
	return "Steam_" + id
}

func grantPlayerMissing(output string) bool {
	text := strings.ToLower(output)
	return strings.Contains(text, "player not found") || strings.Contains(text, "must be online") || strings.Contains(text, "could not get the player")
}

func grantItemInvalid(output string) bool {
	text := strings.ToLower(output)
	return strings.Contains(text, "item not found") || strings.Contains(text, "invalid value for") || strings.Contains(text, "not a valid")
}
