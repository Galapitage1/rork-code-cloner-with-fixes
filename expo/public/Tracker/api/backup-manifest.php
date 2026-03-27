<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once __DIR__ . '/backup-common.php';

$settings = gd_backup_load_settings();
$manifest = gd_backup_read_json_file(gd_backup_manifest_path(), []);

gd_backup_respond([
    'success' => true,
    'connected' => trim((string)($settings['refresh_token'] ?? '')) !== '',
    'settings' => gd_backup_sanitized_settings($settings),
    'manifest' => $manifest,
]);
