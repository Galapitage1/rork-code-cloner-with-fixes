<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once __DIR__ . '/backup-common.php';

try {
    $settings = gd_backup_load_settings();
    $manifest = gd_backup_read_json_file(gd_backup_manifest_path(), []);

    if (trim((string)($settings['refresh_token'] ?? '')) === '') {
        gd_backup_respond([
            'success' => true,
            'connected' => false,
            'manifest' => $manifest,
            'backups' => [],
        ]);
    }

    $accessToken = gd_backup_refresh_access_token($settings);
    $listing = gd_backup_list_full_backups($settings, $accessToken);

    gd_backup_respond([
        'success' => true,
        'connected' => true,
        'manifest' => $manifest,
        'rootFolder' => $listing['rootFolder'],
        'fullFolder' => $listing['fullFolder'],
        'backups' => $listing['files'],
    ]);
} catch (Exception $e) {
    gd_backup_respond(['success' => false, 'error' => $e->getMessage()], 500);
}
