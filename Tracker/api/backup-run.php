<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once __DIR__ . '/backup-common.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        gd_backup_respond(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $input = file_get_contents('php://input');
    $payload = json_decode($input, true);
    $mode = is_array($payload) && isset($payload['mode']) ? trim((string)$payload['mode']) : 'full';
    if ($mode !== 'full') {
        throw new Exception('Only full backup is available in Phase 1');
    }

    $settings = gd_backup_load_settings();
    $accessToken = gd_backup_refresh_access_token($settings);
    $rootFolder = gd_backup_resolve_root_folder($settings, $accessToken);
    $fullFolder = gd_backup_ensure_folder($settings, $accessToken, GD_BACKUP_FULL_SUBFOLDER, (string)$rootFolder['id']);

    $snapshot = gd_backup_create_full_snapshot_zip();
    $bytes = @file_get_contents($snapshot['tempPath']);
    if (!is_string($bytes)) {
        throw new Exception('Failed to read generated backup archive');
    }

    $uploaded = gd_backup_upload_file($settings, $accessToken, (string)$fullFolder['id'], $snapshot['fileName'], 'application/zip', $bytes);
    $manifest = gd_backup_update_manifest_after_full_backup($uploaded, $snapshot['manifest']);

    @unlink($snapshot['tempPath']);

    gd_backup_respond([
        'success' => true,
        'mode' => 'full',
        'file' => $uploaded,
        'manifest' => $manifest,
        'rootFolder' => $rootFolder,
        'fullFolder' => $fullFolder,
    ]);
} catch (Exception $e) {
    gd_backup_respond(['success' => false, 'error' => $e->getMessage()], 500);
}
