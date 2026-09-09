<?php
require_once __DIR__ . '/lang.php';
require_once __DIR__ . '/TtpParser.php';

$error_message = '';
$parsed_data = null;
$orig_file_b64 = $_SESSION['orig_file_b64'] ?? null;

if (isset($_GET['reset']) && $_GET['reset'] === '1') {
    unset($_SESSION['parsed_data'], $_SESSION['orig_file_b64']);
    header('Location: index.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST'
    && isset($_FILES['ttpFile'])
    && $_FILES['ttpFile']['error'] === UPLOAD_ERR_OK) {

    $file_tmp_path = $_FILES['ttpFile']['tmp_name'];
    $file_name = $_FILES['ttpFile']['name'];

    if (strtolower(pathinfo($file_name, PATHINFO_EXTENSION)) === 'ttp') {
        try {
            $parser = new TtpParser($file_tmp_path);
            $parsed_data = $parser->parse();

            $_SESSION['parsed_data'] = $parsed_data;
            $_SESSION['orig_file_b64'] = base64_encode(file_get_contents($file_tmp_path));
            $orig_file_b64 = $_SESSION['orig_file_b64'];
        } catch (Exception $e) {
            $error_message = t('upload.parsing.error') . ' ' . $e->getMessage();
        }
    } else {
        $error_message = t('upload.parsing.format');
    }
} else {
    $parsed_data = $_SESSION['parsed_data'] ?? null;
}
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(get_locale(), ENT_QUOTES, 'UTF-8') ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= t('app.title') ?></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f8f9fa; }
        .container { max-width: 1100px; margin-top: 35px; margin-bottom: 35px; background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.1); }
        .data-section { margin-bottom: 2rem; }
        .data-section h2 { border-bottom: 2px solid #dee2e6; padding-bottom: 10px; margin-bottom: 15px; }
        .list-group-item { word-break: break-all; }
        .text-monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
        .offset-label { font-size: .75rem; }
        .progression-table td, .progression-table th { vertical-align: middle; }
        .progression-name { min-width: 290px; }
        .progression-value { width: 125px; }
        .accordion-button:not(.collapsed) { box-shadow: none; }
    </style>
</head>
<body>
<div class="container">
    <div class="text-end mb-3">
        <small><?= t('nav.language') ?>:
            <a href="?lang=en">English</a> |
            <a href="?lang=ja">日本語</a>
        </small>
    </div>

    <h1><?= t('section.main.container') ?></h1>

    <?php if ($error_message): ?>
        <div class="alert alert-danger"><?= htmlspecialchars($error_message, ENT_QUOTES, 'UTF-8') ?></div>
        <a href="index.php" class="btn btn-primary"><?= t('upload.error') ?></a>

    <?php elseif ($parsed_data): ?>
        <?php
        $player = $parsed_data['player_info'] ?? [];
        $name = isset($player['name'])
            ? htmlspecialchars($player['name'], ENT_QUOTES, 'UTF-8')
            : t('common.not_found');
        $eosId = isset($player['eos_id'])
            ? htmlspecialchars($player['eos_id'], ENT_QUOTES, 'UTF-8')
            : t('common.not_found');
        $coreStats = $parsed_data['core_stats'] ?? ['detected' => false, 'stats' => []];
        $deathState = $parsed_data['death_state'] ?? ['detected' => false, 'dead' => null];
        $progression = $parsed_data['progression'] ?? ['detected' => false, 'entries' => []];

        $progressionGroups = [
            'attributes' => [],
            'skills' => [],
            'crafting' => [],
            'perks' => [],
            'other' => [],
        ];
        foreach (($progression['entries'] ?? []) as $entry) {
            $category = $entry['category'] ?? 'other';
            if (!isset($progressionGroups[$category])) $category = 'other';
            $progressionGroups[$category][] = $entry;
        }
        ?>

        <div class="data-section">
            <h2><span class="badge bg-primary"><?= t('section.player_info') ?></span></h2>
            <dl class="row mb-0">
                <dt class="col-sm-4"><?= t('player.name') ?></dt>
                <dd class="col-sm-8"><?= $name ?></dd>
                <dt class="col-sm-4"><?= t('player.id') ?></dt>
                <dd class="col-sm-8"><span class="text-monospace"><?= $eosId ?></span></dd>
            </dl>
        </div>

        <form action="save.php" method="post" id="profile-edit-form">
            <input type="hidden" name="orig_file_b64"
                   value="<?= htmlspecialchars($orig_file_b64 ?? '', ENT_QUOTES, 'UTF-8') ?>">

            <div class="data-section">
                <h2><span class="badge bg-danger"><?= t('section.vitals') ?></span></h2>
                <p class="text-muted small mb-3"><?= t('vitals.help') ?></p>

                <?php if (!empty($coreStats['detected'])): ?>
                    <?php if (!empty($deathState['detected'])): ?>
                        <div class="alert <?= !empty($deathState['dead']) ? 'alert-danger' : 'alert-success' ?> py-2">
                            <strong><?= t('vitals.death_state') ?>:</strong>
                            <?= !empty($deathState['dead']) ? t('vitals.state.dead') : t('vitals.state.alive') ?>
                            <span class="text-muted offset-label ms-2">
                                bDead @ 0x<?= strtoupper(dechex((int)$deathState['dead_flag_offset'])) ?>
                            </span>
                        </div>
                    <?php else: ?>
                        <div class="alert alert-warning py-2"><?= t('vitals.death_not_detected') ?></div>
                    <?php endif; ?>

                    <div class="table-responsive">
                        <table class="table table-sm table-striped align-middle">
                            <thead>
                            <tr>
                                <th><?= t('vitals.stat') ?></th>
                                <th><?= t('vitals.current') ?></th>
                                <th><?= t('vitals.maximum') ?></th>
                                <th><?= t('vitals.offset') ?></th>
                            </tr>
                            </thead>
                            <tbody>
                            <?php foreach (['health', 'stamina', 'food', 'water'] as $statKey):
                                $stat = $coreStats['stats'][$statKey];
                                $currentValue = sprintf('%.9G', (float)$stat['current']);
                                $maximumValue = sprintf('%.9G', (float)$stat['maximum']);
                                ?>
                                <tr>
                                    <td><strong><?= t('vitals.' . $statKey) ?></strong></td>
                                    <td style="min-width:190px;">
                                        <input type="number"
                                               class="form-control form-control-sm"
                                               id="vital_<?= $statKey ?>"
                                               name="vitals[<?= $statKey ?>]"
                                               value="<?= htmlspecialchars($currentValue, ENT_QUOTES, 'UTF-8') ?>"
                                               min="0" max="10000" step="any"
                                               data-maximum="<?= htmlspecialchars($maximumValue, ENT_QUOTES, 'UTF-8') ?>"
                                               required>
                                    </td>
                                    <td><?= htmlspecialchars($maximumValue, ENT_QUOTES, 'UTF-8') ?></td>
                                    <td class="text-monospace offset-label">0x<?= strtoupper(dechex((int)$stat['current_offset'])) ?></td>
                                </tr>
                            <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>

                    <div class="form-check border rounded p-3 ps-5 bg-light">
                        <input class="form-check-input" type="checkbox" name="resurrect_player"
                               id="resurrect_player" value="1"
                            <?= empty($deathState['detected']) ? 'disabled' : '' ?>>
                        <label class="form-check-label fw-semibold" for="resurrect_player">
                            <?= t('vitals.resurrect') ?>
                        </label>
                        <div class="form-text"><?= t('vitals.resurrect_help') ?></div>
                    </div>
                <?php else: ?>
                    <div class="alert alert-warning"><?= t('vitals.not_detected') ?></div>
                <?php endif; ?>
            </div>

            <div class="data-section">
                <h2><span class="badge bg-warning text-dark"><?= t('section.progression') ?></span></h2>

                <?php if (!empty($progression['detected'])): ?>
                    <div class="alert alert-info">
                        <strong><?= t('progression.fixed_title') ?></strong><br>
                        <?= t('progression.fixed_help') ?>
                    </div>

                    <div class="row g-3 mb-3">
                        <div class="col-md-4">
                            <label for="player_level" class="form-label fw-semibold"><?= t('progression.player_level') ?></label>
                            <input type="number" class="form-control" id="player_level"
                                   name="progression[level]"
                                   value="<?= (int)$progression['level'] ?>"
                                   data-original-level="<?= (int)$progression['level'] ?>"
                                   min="1" max="1000" step="1" required>
                            <div class="form-text">0x<?= strtoupper(dechex((int)$progression['level_offset'])) ?></div>
                        </div>
                        <div class="col-md-4">
                            <label for="player_experience" class="form-label fw-semibold"><?= t('progression.experience') ?></label>
                            <input type="number" class="form-control" id="player_experience"
                                   name="progression[experience]"
                                   value="<?= (int)$progression['experience'] ?>"
                                   data-original-experience="<?= (int)$progression['experience'] ?>"
                                   min="0" max="4294967295" step="1" required>
                            <div class="form-text"><?= t('progression.experience_help') ?></div>
                        </div>
                        <div class="col-md-4">
                            <label for="player_skill_points" class="form-label fw-semibold"><?= t('progression.skill_points') ?></label>
                            <input type="number" class="form-control" id="player_skill_points"
                                   name="progression[skill_points]"
                                   value="<?= (int)$progression['skill_points'] ?>"
                                   min="0" max="65535" step="1" required>
                            <button type="button" class="btn btn-outline-secondary btn-sm mt-2" id="grant-level-points">
                                <?= t('progression.grant_level_points') ?>
                            </button>
                            <div class="form-text"><?= t('progression.skill_points_help') ?></div>
                        </div>
                    </div>

                    <div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
                        <div>
                            <strong><?= t('progression.entries') ?>:</strong>
                            <?= (int)$progression['entry_count'] ?>
                            <span class="text-muted ms-2">
                                <?= t('progression.block_offset') ?>:
                                0x<?= strtoupper(dechex((int)$progression['block_start'])) ?>
                            </span>
                        </div>
                        <div style="min-width:280px;">
                            <label for="progression-search" class="form-label mb-1"><?= t('progression.search') ?></label>
                            <input type="search" class="form-control form-control-sm" id="progression-search"
                                   placeholder="<?= t('progression.search_placeholder') ?>">
                        </div>
                    </div>

                    <p class="text-muted small"><?= t('progression.entry_help') ?></p>

                    <div class="accordion" id="progression-accordion">
                        <?php $accordionIndex = 0; ?>
                        <?php foreach ($progressionGroups as $category => $entries): ?>
                            <?php if (!$entries) continue; ?>
                            <?php
                            $accordionIndex++;
                            $headingId = 'progression-heading-' . $category;
                            $collapseId = 'progression-collapse-' . $category;
                            $expanded = ($category === 'attributes');
                            ?>
                            <div class="accordion-item progression-group">
                                <h2 class="accordion-header" id="<?= $headingId ?>">
                                    <button class="accordion-button <?= $expanded ? '' : 'collapsed' ?>" type="button"
                                            data-bs-toggle="collapse" data-bs-target="#<?= $collapseId ?>"
                                            aria-expanded="<?= $expanded ? 'true' : 'false' ?>" aria-controls="<?= $collapseId ?>">
                                        <?= t('progression.category.' . $category) ?>
                                        <span class="badge bg-secondary ms-2"><?= count($entries) ?></span>
                                    </button>
                                </h2>
                                <div id="<?= $collapseId ?>" class="accordion-collapse collapse <?= $expanded ? 'show' : '' ?>"
                                     aria-labelledby="<?= $headingId ?>" data-bs-parent="#progression-accordion">
                                    <div class="accordion-body p-0">
                                        <div class="table-responsive" style="max-height:520px; overflow-y:auto;">
                                            <table class="table table-sm table-striped progression-table mb-0">
                                                <thead class="table-light sticky-top">
                                                <tr>
                                                    <th class="progression-name"><?= t('progression.name') ?></th>
                                                    <th><?= t('progression.value') ?></th>
                                                    <th><?= t('progression.auxiliary') ?></th>
                                                    <th><?= t('vitals.offset') ?></th>
                                                </tr>
                                                </thead>
                                                <tbody>
                                                <?php foreach ($entries as $entry): ?>
                                                    <?php $index = (int)$entry['index']; ?>
                                                    <tr class="progression-row"
                                                        data-search="<?= htmlspecialchars(strtolower((string)$entry['name']), ENT_QUOTES, 'UTF-8') ?>">
                                                        <td class="text-monospace progression-name">
                                                            <?= htmlspecialchars((string)$entry['name'], ENT_QUOTES, 'UTF-8') ?>
                                                            <input type="hidden"
                                                                   name="progression_entries[<?= $index ?>][name]"
                                                                   value="<?= htmlspecialchars((string)$entry['name'], ENT_QUOTES, 'UTF-8') ?>">
                                                        </td>
                                                        <td class="progression-value">
                                                            <input type="number" class="form-control form-control-sm"
                                                                   name="progression_entries[<?= $index ?>][value]"
                                                                   value="<?= (int)$entry['value'] ?>"
                                                                   min="0" max="255" step="1" required>
                                                        </td>
                                                        <td class="text-monospace small text-muted">
                                                            0x<?= strtoupper(str_pad(dechex((int)$entry['auxiliary']), 8, '0', STR_PAD_LEFT)) ?>
                                                        </td>
                                                        <td class="text-monospace offset-label">
                                                            0x<?= strtoupper(dechex((int)$entry['value_offset'])) ?>
                                                        </td>
                                                    </tr>
                                                <?php endforeach; ?>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                <?php else: ?>
                    <div class="alert alert-warning"><?= t('progression.not_detected') ?></div>
                <?php endif; ?>
            </div>

            <div class="data-section">
                <h2><span class="badge bg-success"><?= t('section.quests_pois') ?></span></h2>
                <p class="text-muted small mb-1"><?= t('quests.help') ?></p>
                <p class="text-muted small mb-2"><?= t('quests.filtered_help') ?></p>
                <div class="mb-2">
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="checkbox" id="rq_all" name="quests_remove_all" value="1">
                        <label class="form-check-label small" for="rq_all"><?= t('quests.remove_all') ?></label>
                    </div>
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="checkbox" id="rq_status_only" name="quests_status_only" value="1">
                        <label class="form-check-label small" for="rq_status_only"><?= t('quests.status_only') ?></label>
                    </div>
                </div>
                <?php
                $questPoiEntries = $parsed_data['quests_and_pois'] ?? [];
                if (!is_array($questPoiEntries)) $questPoiEntries = [];
                ?>

                <?php if ($questPoiEntries): ?>
                    <ul class="list-group list-group-flush" style="max-height:280px; overflow-y:auto;">
                        <?php foreach ($questPoiEntries as $i => $entry):
                            // Backward-compatible handling for parsed data still in an old session.
                            $raw = is_array($entry) ? (string)($entry['raw'] ?? '') : (string)$entry;
                            $label = is_array($entry) ? (string)($entry['label'] ?? $raw) : $raw;
                            $type = is_array($entry) ? (string)($entry['type'] ?? 'quest') : 'quest';
                            $offset = is_array($entry) ? ($entry['offset'] ?? null) : null;

                            // Never render a selectable blank row. New parser results are ASCII,
                            // and this also filters malformed entries left in a previous session.
                            if ($raw === '' || $label === '' || preg_match('/^[\x20-\x7E]+$/D', $raw) !== 1) continue;

                            $typeKey = in_array($type, ['quest', 'tier', 'poi'], true) ? $type : 'quest';
                        ?>
                            <li class="list-group-item d-flex justify-content-between align-items-start gap-3">
                                <div class="min-w-0">
                                    <div class="d-flex flex-wrap align-items-center gap-2">
                                        <span class="badge text-bg-secondary"><?= t('quests.type.' . $typeKey) ?></span>
                                        <span class="fw-semibold"><?= htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></span>
                                    </div>
                                    <div class="small text-muted text-monospace mt-1">
                                        <?= t('quests.stored_id') ?>:
                                        <?= htmlspecialchars($raw, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?>
                                        <?php if (is_int($offset)): ?>
                                            · 0x<?= strtoupper(dechex($offset)) ?>
                                        <?php endif; ?>
                                    </div>
                                </div>
                                <div class="form-check m-0 flex-shrink-0">
                                    <input class="form-check-input" type="checkbox" name="remove_quests[]"
                                           id="rq<?= $i ?>" value="<?= htmlspecialchars($raw, ENT_QUOTES, 'UTF-8') ?>">
                                    <label class="form-check-label small text-danger" for="rq<?= $i ?>"><?= t('quests.remove') ?></label>
                                </div>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                <?php else: ?>
                    <div class="alert alert-secondary small mb-0"><?= t('quests.none') ?></div>
                <?php endif; ?>
            </div>

            <div class="alert alert-warning small">
                <?= t('progression.backup_warning') ?>
            </div>

            <button type="submit" class="btn btn-success"><?= t('save.download') ?></button>
            <a href="upload.php?reset=1" class="btn btn-outline-secondary ms-2"><?= t('nav.analyze_another') ?></a>
        </form>
    <?php endif; ?>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script>
(function () {
    const resurrectInput = document.getElementById('resurrect_player');
    if (resurrectInput) {
        resurrectInput.addEventListener('change', () => {
            if (!resurrectInput.checked) return;
            const ratios = {health: 0.90, stamina: 1.00, food: 0.90, water: 0.90};
            Object.entries(ratios).forEach(([name, ratio]) => {
                const input = document.getElementById('vital_' + name);
                if (!input) return;
                const maximum = Number(input.dataset.maximum);
                if (!Number.isFinite(maximum) || maximum <= 0) return;
                input.value = String(Math.round(maximum * ratio * 100) / 100);
            });
        });
    }

    const grantButton = document.getElementById('grant-level-points');
    const levelInput = document.getElementById('player_level');
    const pointsInput = document.getElementById('player_skill_points');
    const experienceInput = document.getElementById('player_experience');
    if (grantButton && levelInput && pointsInput) {
        grantButton.addEventListener('click', () => {
            const level = Math.max(1, Math.floor(Number(levelInput.value) || 1));
            // This helper assumes one point per level after level 1.
            pointsInput.value = String(Math.max(0, level - 1));
        });
    }
    if (levelInput && experienceInput) {
        const originalLevel = Number(levelInput.dataset.originalLevel);
        const originalExperience = Number(experienceInput.dataset.originalExperience);
        let experienceTouched = false;
        experienceInput.addEventListener('input', () => { experienceTouched = true; });
        const vanillaXpToNextLevel = (level) => {
            const clamped = Math.min(Math.max(Math.floor(level) || 1, 1), 60);
            return Math.floor(10000 * Math.pow(1.05, clamped - 1));
        };
        levelInput.addEventListener('input', () => {
            if (experienceTouched) return;
            const level = Math.max(1, Math.floor(Number(levelInput.value) || 1));
            experienceInput.value = String(level === originalLevel ? originalExperience : vanillaXpToNextLevel(level));
        });
    }

    const search = document.getElementById('progression-search');
    if (search) {
        search.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            document.querySelectorAll('.progression-row').forEach(row => {
                row.hidden = query !== '' && !row.dataset.search.includes(query);
            });
            document.querySelectorAll('.progression-group').forEach(group => {
                const visibleRows = Array.from(group.querySelectorAll('.progression-row')).some(row => !row.hidden);
                group.hidden = !visibleRows;
            });
        });
    }
})();
</script>
</body>
</html>
