<?php
require_once __DIR__ . '/TtpParser.php';

error_reporting(E_ALL);
ini_set('display_errors', '1');

function bad_request(string $message): void
{
    http_response_code(400);
    echo '<h3>Error</h3><pre>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</pre>';
    exit;
}

function replace_bytes(string $content, int $offset, string $replacement, int $length): string
{
    if ($offset < 0 || $offset + $length > strlen($content)) {
        bad_request('A requested binary offset was outside the file.');
    }
    return substr_replace($content, $replacement, $offset, $length);
}

function read_float_le(string $content, int $offset): float
{
    $value = unpack('gvalue', substr($content, $offset, 4));
    return (float)($value['value'] ?? NAN);
}

function parse_unsigned_field(mixed $value, int $minimum, int $maximum, string $fieldName): int
{
    $text = trim((string)$value);
    if ($text === '' || !preg_match('/^\d+$/', $text)) {
        bad_request($fieldName . ' must be a whole number.');
    }

    $number = (int)$text;
    if ($number < $minimum || $number > $maximum) {
        bad_request($fieldName . " must be between {$minimum} and {$maximum}.");
    }

    return $number;
}

// Matches this world's progression.xml:
// exp_to_level=10000, experience_multiplier=1.05, clamp_exp_cost_at_level=60.
function vanilla_xp_to_next_level(int $level): int
{
    $level = max(1, min($level, 300));
    $clamped = min($level, 60);
    return (int) floor(10000 * (1.05 ** ($clamped - 1)));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    bad_request('POST required.');
}

$origB64 = $_POST['orig_file_b64'] ?? null;
if (!is_string($origB64) || $origB64 === '') {
    bad_request('Missing orig_file_b64.');
}

$content = base64_decode($origB64, true);
if ($content === false) {
    bad_request('Invalid base64 for orig_file_b64.');
}

if (substr($content, 0, 4) !== "ttp\x00") {
    bad_request('The uploaded data does not have a valid TTP header.');
}

$applied = [];
$skipped = [];

// -----------------------------------------------------------------------------
// Core stats: Health, Stamina, Food, Water
// -----------------------------------------------------------------------------
$vitals = $_POST['vitals'] ?? [];
if (!is_array($vitals)) $vitals = [];

$coreLayout = TtpParser::inspectCoreStats($content);
if ($vitals && empty($coreLayout['detected'])) {
    bad_request('The Health/Stamina/Food/Water block could not be detected safely.');
}

foreach (['health', 'stamina', 'food', 'water'] as $statName) {
    if (!array_key_exists($statName, $vitals)) continue;

    $rawValue = trim((string)$vitals[$statName]);
    if ($rawValue === '' || !is_numeric($rawValue)) {
        $skipped[] = ['name' => $statName, 'reason' => 'invalid numeric value'];
        continue;
    }

    $value = (float)$rawValue;
    if (!is_finite($value) || $value < 0 || $value > 10000) {
        $skipped[] = ['name' => $statName, 'reason' => 'value must be between 0 and 10000'];
        continue;
    }

    $stat = $coreLayout['stats'][$statName] ?? null;
    if (!is_array($stat) || !isset($stat['current_offset'])) {
        $skipped[] = ['name' => $statName, 'reason' => 'stat offset not detected'];
        continue;
    }

    $offset = (int)$stat['current_offset'];
    $content = replace_bytes($content, $offset, pack('g', $value), 4);
    $applied[] = ['name' => $statName, 'action' => 'set_core_stat', 'pos' => $offset, 'value' => $value];
}

// -----------------------------------------------------------------------------
// Resurrect player
// -----------------------------------------------------------------------------
if (!empty($_POST['resurrect_player'])) {
    $deathState = TtpParser::inspectDeathState($content);
    $coreLayout = TtpParser::inspectCoreStats($content);

    if (empty($deathState['detected'])) {
        bad_request('The bDead structure could not be detected safely.');
    }
    if (empty($coreLayout['detected'])) {
        bad_request('The core-stat structure could not be detected safely.');
    }

    $content = replace_bytes($content, (int)$deathState['dead_flag_offset'], "\x00", 1);
    $content = replace_bytes($content, (int)$deathState['death_update_time_offset'], pack('V', 0), 4);
    $content = replace_bytes($content, (int)$deathState['current_life_offset'], pack('g', 0.0), 4);

    $health = $coreLayout['stats']['health'];
    $currentHealth = read_float_le($content, (int)$health['current_offset']);
    if (!is_finite($currentHealth) || $currentHealth <= 0) {
        $restoredHealth = max(1.0, (float)$health['maximum'] * 0.90);
        $content = replace_bytes($content, (int)$health['current_offset'], pack('g', $restoredHealth), 4);
    }

    foreach (['stamina' => 1.0, 'food' => 0.90, 'water' => 0.90] as $statName => $ratio) {
        $stat = $coreLayout['stats'][$statName];
        $current = read_float_le($content, (int)$stat['current_offset']);
        if (!is_finite($current) || $current <= 0) {
            $restored = max(1.0, (float)$stat['maximum'] * $ratio);
            $content = replace_bytes($content, (int)$stat['current_offset'], pack('g', $restored), 4);
        }
    }

    $applied[] = ['name' => 'player', 'action' => 'resurrect', 'dead_flag_offset' => (int)$deathState['dead_flag_offset']];
}

// -----------------------------------------------------------------------------
// Human-readable progression header: Level, Experience, Unspent Skill Points
// -----------------------------------------------------------------------------
$progressionPost = $_POST['progression'] ?? [];
$progressionEntriesPost = $_POST['progression_entries'] ?? [];
if (!is_array($progressionPost)) $progressionPost = [];
if (!is_array($progressionEntriesPost)) $progressionEntriesPost = [];

if ($progressionPost || $progressionEntriesPost) {
    $progression = TtpParser::inspectProgression($content);
    if (empty($progression['detected'])) {
        bad_request('The progression block could not be detected safely.');
    }

    $originalLevel = (int) $progression['level'];
    $originalExperience = (int) $progression['experience'];
    $newLevel = $originalLevel;
    $newExperience = $originalExperience;

    if (array_key_exists('level', $progressionPost)) {
        $newLevel = parse_unsigned_field($progressionPost['level'], 1, 1000, 'Player level');
    }
    if (array_key_exists('experience', $progressionPost)) {
        $newExperience = parse_unsigned_field($progressionPost['experience'], 0, 4294967295, 'Experience');
    }

    // Changing only the level used to keep the old XP-to-next value, which
    // freezes the player at that level. Sync vanilla XP-to-next unless the
    // operator also edited experience.
    if ($newLevel !== $originalLevel && $newExperience === $originalExperience) {
        $newExperience = vanilla_xp_to_next_level($newLevel);
    }

    if ($newLevel !== $originalLevel) {
        $content = replace_bytes($content, (int) $progression['level_offset'], pack('v', $newLevel), 2);
        $applied[] = ['name' => 'player_level', 'action' => 'set_progression_header', 'value' => $newLevel];
    }
    if ($newExperience !== $originalExperience) {
        $content = replace_bytes($content, (int) $progression['experience_offset'], pack('V', $newExperience), 4);
        $applied[] = ['name' => 'experience', 'action' => 'set_progression_header', 'value' => $newExperience];
    }

    if (array_key_exists('skill_points', $progressionPost)) {
        $skillPoints = parse_unsigned_field($progressionPost['skill_points'], 0, 65535, 'Unspent skill points');
        $content = replace_bytes($content, (int)$progression['skill_points_offset'], pack('v', $skillPoints), 2);
        $applied[] = ['name' => 'skill_points', 'action' => 'set_progression_header', 'value' => $skillPoints];
    }

    // Re-read after header edits. The record offsets must still match exactly.
    $progression = TtpParser::inspectProgression($content);
    if (empty($progression['detected'])) {
        bad_request('The progression block failed validation after editing its header.');
    }

    $recordsByIndex = [];
    foreach ($progression['entries'] as $record) {
        $recordsByIndex[(int)$record['index']] = $record;
    }

    foreach ($progressionEntriesPost as $postedIndex => $row) {
        if (!is_array($row) || !preg_match('/^\d+$/', (string)$postedIndex)) continue;

        $index = (int)$postedIndex;
        $record = $recordsByIndex[$index] ?? null;
        if (!is_array($record)) {
            $skipped[] = ['name' => (string)$postedIndex, 'reason' => 'progression record not found'];
            continue;
        }

        $postedName = (string)($row['name'] ?? '');
        if ($postedName !== (string)$record['name']) {
            bad_request('A progression record name did not match the uploaded file.');
        }

        if (!array_key_exists('value', $row)) continue;
        $value = parse_unsigned_field($row['value'], 0, 255, 'Progression value for ' . $postedName);

        if ($value === (int)$record['value']) continue;

        // Only replace the one-byte human-facing value after the name.
        // The following four auxiliary bytes are deliberately preserved.
        $content = replace_bytes($content, (int)$record['value_offset'], chr($value), 1);
        $applied[] = [
            'name' => $postedName,
            'action' => 'set_progression_value',
            'pos' => (int)$record['value_offset'],
            'old_value' => (int)$record['value'],
            'value' => $value,
        ];
    }
}

// -----------------------------------------------------------------------------
// Remove Quests & POIs (legacy experimental feature)
// -----------------------------------------------------------------------------
$removeQuests = $_POST['remove_quests'] ?? [];
if (!is_array($removeQuests)) $removeQuests = [];
$removeQuests = array_values(array_unique(array_filter(array_map('strval', $removeQuests))));

$removeAllQuests = !empty($_POST['quests_remove_all']);
$questStatusOnly = !empty($_POST['quests_status_only']);

foreach ($removeQuests as $token) {
    $length = strlen($token);
    if ($length === 0) continue;

    $searchOffset = 0;
    do {
        $position = strpos($content, $token, $searchOffset);
        if ($position === false) break;

        $statusPosition = $position - 4;
        if ($statusPosition >= 0 && $statusPosition + 4 <= strlen($content)) {
            $content = replace_bytes($content, $statusPosition, "\x00\x00\x00\x00", 4);
        }

        if (!$questStatusOnly) {
            $content = replace_bytes($content, $position, str_repeat("\x00", $length), $length);
        }

        $applied[] = ['name' => $token, 'action' => 'remove_quest', 'pos' => $position];
        $searchOffset = $position + $length;
    } while ($removeAllQuests);
}

$downloadName = 'edited_' . date('Ymd_His') . '.ttp';
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . strlen($content));
header('X-Content-Type-Options: nosniff');
echo $content;
