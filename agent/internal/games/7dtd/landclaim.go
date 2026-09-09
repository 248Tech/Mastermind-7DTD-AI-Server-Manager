package sevendtd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/mastermind/agent/internal/agent"
)

var landClaimMu sync.Mutex

var playerTagPattern = regexp.MustCompile(`(?is)<Player\b[^>]*?/?>`)
var xmlCommentPattern = regexp.MustCompile(`(?s)<!--.*?-->`)

func applyLandClaimReward(ctx context.Context, adapter *Adapter, cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	bonus, err := landClaimBonusClaims(payload)
	if err != nil {
		return nil, err
	}
	serverDefault, err := readServerLandClaimDefault(cfg, payload)
	if err != nil {
		return nil, err
	}
	count := serverDefault + bonus
	if count < 1 {
		count = 1
	}
	if count > 100 {
		count = 100
	}
	name := strings.TrimSpace(getString(payload, "name", ""))
	steamId := strings.TrimSpace(getString(payload, "steamId", ""))
	eosId := strings.TrimSpace(getString(payload, "eosId", ""))
	ids := landClaimIDs(steamId, eosId)
	if len(ids) == 0 {
		return nil, fmt.Errorf("player Steam or EOS id is required")
	}
	root, err := modsPath(cfg, getString(payload, "mods_path", ""))
	if err != nil {
		return nil, err
	}
	target := filepath.Join(root, "ServerTools_Config", "LandClaimCount.xml")
	landClaimMu.Lock()
	defer landClaimMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(target), 0750); err != nil {
		return nil, fmt.Errorf("create ServerTools config directory: %w", err)
	}
	current := ""
	if data, readErr := os.ReadFile(target); readErr == nil {
		current = string(data)
	} else if !os.IsNotExist(readErr) {
		return nil, fmt.Errorf("read LandClaimCount.xml: %w", readErr)
	}
	next := upsertLandClaimXML(current, ids, name, count)
	if _, statErr := os.Stat(target); statErr == nil {
		if err := ensureModConfigWritable(target); err != nil {
			return nil, err
		}
	}
	info, statErr := os.Stat(target)
	mode := os.FileMode(0660)
	if statErr == nil {
		mode = info.Mode().Perm()
	}
	if _, statErr := os.Stat(target); os.IsNotExist(statErr) {
		if err := os.WriteFile(target, []byte(next), 0660); err != nil {
			return nil, fmt.Errorf("create LandClaimCount.xml: %w", err)
		}
	} else if err := writeModConfigFile(target, next, mode); err != nil {
		return nil, fmt.Errorf("write LandClaimCount.xml: %w", err)
	}
	message := strings.ReplaceAll(getString(payload, "message", "You reached the land-claim reward level."), "{claims}", strconv.Itoa(count))
	notified := sendTriggerNotice(ctx, adapter, cfg, payload, message)
	return map[string]interface{}{
		"path":          target,
		"serverDefault": serverDefault,
		"bonusClaims":   bonus,
		"claimCount":    count,
		"ids":           ids,
		"notified":      notified,
	}, nil
}

func readServerLandClaimDefault(cfg *agent.InstanceConfig, payload map[string]interface{}) (int, error) {
	configPath := strings.TrimSpace(getString(payload, "server_config_path", ""))
	if configPath == "" {
		configPath = filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	}
	value, err := readServerConfigProperty(configPath, "LandClaimCount")
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(value) == "" {
		return 1, nil
	}
	count, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || count < 1 {
		return 1, nil
	}
	if count > 100 {
		return 100, nil
	}
	return count, nil
}

func landClaimBonusClaims(payload map[string]interface{}) (int, error) {
	if _, ok := payload["bonusClaims"]; ok {
		return parseLandClaimBonus(payload["bonusClaims"])
	}
	if _, ok := payload["claimCount"]; ok {
		return parseLandClaimBonus(payload["claimCount"])
	}
	return 0, fmt.Errorf("claim bonus is required")
}

func parseLandClaimBonus(raw interface{}) (int, error) {
	switch value := raw.(type) {
	case float64:
		count := int(value)
		if count < 0 || count > 100 {
			return 0, fmt.Errorf("claim bonus must be between 0 and 100")
		}
		return count, nil
	case int:
		if value < 0 || value > 100 {
			return 0, fmt.Errorf("claim bonus must be between 0 and 100")
		}
		return value, nil
	case string:
		count, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || count < 0 || count > 100 {
			return 0, fmt.Errorf("claim bonus must be between 0 and 100")
		}
		return count, nil
	default:
		return 0, fmt.Errorf("claim bonus is required")
	}
}

func landClaimIDs(steamId, eosId string) []string {
	ids := make([]string, 0, 2)
	add := func(value string) {
		id := canonicalizeLandClaimID(value)
		if id == "" {
			return
		}
		for _, existing := range ids {
			if strings.EqualFold(existing, id) {
				return
			}
		}
		ids = append(ids, id)
	}
	add(steamId)
	add(eosId)
	return ids
}

type landClaimEntry struct {
	ID    string
	Name  string
	Limit int
}

func upsertLandClaimXML(raw string, ids []string, name string, count int) string {
	keys := uniqueLandClaimIDs(ids)
	if len(keys) == 0 {
		return raw
	}
	if strings.TrimSpace(name) == "" {
		name = "Unknown"
	}
	head, entries, tail := splitLandClaimXML(raw)
	drop := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		drop[strings.ToLower(key)] = struct{}{}
	}
	kept := make([]landClaimEntry, 0, len(entries)+len(keys))
	for _, entry := range entries {
		if _, skip := drop[strings.ToLower(entry.ID)]; skip {
			continue
		}
		kept = append(kept, entry)
	}
	for _, key := range keys {
		kept = append(kept, landClaimEntry{ID: key, Name: name, Limit: count})
	}
	return renderLandClaimXML(head, dedupeLandClaimEntries(kept), tail)
}

func uniqueLandClaimIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = canonicalizeLandClaimID(id)
		if id == "" {
			continue
		}
		found := false
		for _, existing := range out {
			if strings.EqualFold(existing, id) {
				found = true
				break
			}
		}
		if !found {
			out = append(out, id)
		}
	}
	return out
}

func canonicalizeLandClaimID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lower := strings.ToLower(value)
	switch {
	case strings.HasPrefix(lower, "steam_"):
		n := strings.TrimPrefix(lower, "steam_")
		if isDigits(n) {
			return "Steam_" + n
		}
	case strings.HasPrefix(lower, "eos_"):
		n := strings.TrimPrefix(lower, "eos_")
		if isHex(n) {
			return "EOS_" + n
		}
	default:
		if isDigits(value) {
			return "Steam_" + value
		}
		if isHex(value) {
			return "EOS_" + strings.ToLower(value)
		}
	}
	return ""
}

func isHex(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
			return false
		}
	}
	return true
}

func splitLandClaimXML(raw string) (string, []landClaimEntry, string) {
	if strings.TrimSpace(raw) == "" {
		return landClaimHeader, nil, "</LandClaimCount>\n"
	}
	masked := xmlCommentPattern.ReplaceAllStringFunc(raw, func(comment string) string {
		return strings.Repeat(" ", len(comment))
	})
	locs := playerTagPattern.FindAllStringIndex(masked, -1)
	if len(locs) == 0 {
		lower := strings.ToLower(raw)
		if loc := strings.LastIndex(lower, "</landclaimcount"); loc >= 0 {
			return raw[:loc], nil, raw[loc:]
		}
		return strings.TrimRight(raw, " \t\r\n") + "\n", nil, "</LandClaimCount>\n"
	}
	entries := make([]landClaimEntry, 0, len(locs))
	for _, loc := range locs {
		entry, ok := parseLandClaimPlayerTag(raw[loc[0]:loc[1]])
		if ok {
			entries = append(entries, entry)
		}
	}
	head := raw[:locs[0][0]]
	if loc := strings.LastIndex(strings.ToLower(raw), "</landclaimcount"); loc >= locs[len(locs)-1][1] {
		return head, entries, raw[loc:]
	}
	return head, entries, "</LandClaimCount>\n"
}

func parseLandClaimPlayerTag(tag string) (landClaimEntry, bool) {
	id := canonicalizeLandClaimID(xmlAttrValue(tag, "Id"))
	if id == "" {
		id = canonicalizeLandClaimID(xmlAttrValue(tag, "SteamId"))
	}
	if id == "" {
		return landClaimEntry{}, false
	}
	name := strings.TrimSpace(xmlAttrValue(tag, "Name"))
	limit := 1
	if parsed, err := strconv.Atoi(strings.TrimSpace(xmlAttrValue(tag, "Limit"))); err == nil && parsed >= 1 && parsed <= 100 {
		limit = parsed
	}
	return landClaimEntry{ID: id, Name: name, Limit: limit}, true
}

func xmlAttrValue(tag, attr string) string {
	pattern := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(attr) + `\s*=\s*"([^"]*)"`)
	match := pattern.FindStringSubmatch(tag)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func dedupeLandClaimEntries(entries []landClaimEntry) []landClaimEntry {
	order := make([]string, 0, len(entries))
	byID := map[string]landClaimEntry{}
	for _, entry := range entries {
		id := canonicalizeLandClaimID(entry.ID)
		if id == "" {
			continue
		}
		entry.ID = id
		key := strings.ToLower(id)
		if prev, ok := byID[key]; ok {
			if entry.Limit > prev.Limit {
				prev.Limit = entry.Limit
			}
			if strings.TrimSpace(prev.Name) == "" {
				prev.Name = entry.Name
			}
			byID[key] = prev
			continue
		}
		byID[key] = entry
		order = append(order, key)
	}
	out := make([]landClaimEntry, 0, len(order))
	for _, key := range order {
		out = append(out, byID[key])
	}
	return out
}

func renderLandClaimXML(head string, entries []landClaimEntry, tail string) string {
	var b strings.Builder
	b.WriteString(strings.TrimRight(head, " \t\r\n"))
	b.WriteString("\n")
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			name = "Unknown"
		}
		b.WriteString("    ")
		b.WriteString(fmt.Sprintf(`<Player Id="%s" Name="%s" Limit="%d" />`, xmlAttr(entry.ID), xmlAttr(name), entry.Limit))
		b.WriteString("\n")
	}
	tail = strings.TrimSpace(tail)
	if tail == "" {
		tail = "</LandClaimCount>"
	}
	b.WriteString(tail)
	if !strings.HasSuffix(tail, "\n") {
		b.WriteString("\n")
	}
	return b.String()
}

const landClaimHeader = `<?xml version="1.0" encoding="UTF-8"?>
<LandClaimCount Version="3.0.1.4">
    <!-- IMPORTANT: Place comments on their own line directly after the Player entry they belong to or below the comments at the top -->
    <!-- Do not forget to remove these omission tags/arrows on your own entries -->
    <!-- <Player Id="Steam_76561191234567891" Name="SaladFace" Limit="2" /> -->
`

func landClaimDocument(ids []string, name string, count int) string {
	return upsertLandClaimXML("", ids, name, count)
}

func sendTriggerNotice(ctx context.Context, adapter *Adapter, cfg *agent.InstanceConfig, payload map[string]interface{}, message string) bool {
	if !getBool(payload, "notifyPlayer") {
		return false
	}
	notified := false
	for _, command := range triggerNoticeCommands(payload, message) {
		out, err := adapter.SendCommand(ctx, cfg, command)
		if err != nil || noticeCommandFailed(out) {
			continue
		}
		notified = true
	}
	return notified
}

func triggerNoticeCommands(payload map[string]interface{}, message string) []string {
	message = strings.TrimSpace(sanitizeRCONArg(message))
	if message == "" {
		return nil
	}
	entityId := getInt(payload, "entityId", 0)
	if entityId > 0 {
		return []string{fmt.Sprintf("sayplayer %d %q", entityId, message)}
	}
	name := strings.TrimSpace(sanitizeRCONArg(getString(payload, "name", "")))
	if name != "" {
		return []string{fmt.Sprintf("sayplayer %q %q", name, message)}
	}
	return nil
}

func landClaimNotifyCommand(payload map[string]interface{}, message string) string {
	commands := triggerNoticeCommands(payload, message)
	if len(commands) == 0 {
		return ""
	}
	return commands[0]
}

func noticeCommandFailed(out string) bool {
	text := strings.ToLower(out)
	return strings.Contains(text, "unknown command") ||
		strings.Contains(text, "player name or entity id not found") ||
		(strings.Contains(text, "player") && strings.Contains(text, "not found"))
}

func isDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func xmlAttr(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, `"`, "&quot;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	return value
}
