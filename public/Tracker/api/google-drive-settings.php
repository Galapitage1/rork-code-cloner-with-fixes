<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once __DIR__ . '/backup-common.php';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        gd_backup_respond([
            'success' => true,
            'settings' => gd_backup_sanitized_settings(gd_backup_load_settings()),
            'manifest' => gd_backup_read_json_file(gd_backup_manifest_path(), []),
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        gd_backup_respond(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $input = file_get_contents('php://input');
    $payload = json_decode($input, true);
    if (!is_array($payload)) {
        gd_backup_respond(['success' => false, 'error' => 'Invalid request body'], 400);
    }

    $updated = gd_backup_update_settings($payload);
    gd_backup_respond([
        'success' => true,
        'settings' => gd_backup_sanitized_settings($updated),
        'manifest' => gd_backup_read_json_file(gd_backup_manifest_path(), []),
    ]);
} catch (Exception $e) {
    gd_backup_respond(['success' => false, 'error' => $e->getMessage()], 500);
}
