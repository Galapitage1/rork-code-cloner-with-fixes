<?php

require_once __DIR__ . '/dialog_esms_service.php';

const GD_BACKUP_SETTINGS_FILE = 'google_drive_backup_settings.json';
const GD_BACKUP_MANIFEST_FILE = 'backup_manifest.json';
const GD_BACKUP_DEFAULT_ROOT_FOLDER = 'Tracker Backups';
const GD_BACKUP_FULL_SUBFOLDER = 'full';
const GD_BACKUP_SCOPE = 'https://www.googleapis.com/auth/drive';

function gd_backup_respond($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gd_backup_data_dir() {
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function gd_backup_settings_path() {
    return gd_backup_data_dir() . '/' . GD_BACKUP_SETTINGS_FILE;
}

function gd_backup_manifest_path() {
    return gd_backup_data_dir() . '/' . GD_BACKUP_MANIFEST_FILE;
}

function gd_backup_read_json_file($path, $default = []) {
    if (!file_exists($path)) {
        return $default;
    }
    $contents = @file_get_contents($path);
    if (!is_string($contents) || trim($contents) === '') {
        return $default;
    }
    $decoded = json_decode($contents, true);
    return is_array($decoded) ? $decoded : $default;
}

function gd_backup_write_json_file($path, $data) {
    $fp = @fopen($path, 'c+');
    if ($fp === false) {
        throw new Exception('Failed to open backup settings file for writing');
    }
    if (!@flock($fp, LOCK_EX)) {
        @fclose($fp);
        throw new Exception('Failed to lock backup settings file');
    }
    @ftruncate($fp, 0);
    @rewind($fp);
    @fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    @fflush($fp);
    @flock($fp, LOCK_UN);
    @fclose($fp);
    @chmod($path, 0644);
}

function gd_backup_current_origin() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $scheme = trim((string)$_SERVER['HTTP_X_FORWARDED_PROTO']);
    } else {
        $https = isset($_SERVER['HTTPS']) ? strtolower((string)$_SERVER['HTTPS']) : '';
        $scheme = ($https === 'on' || $https === '1') ? 'https' : 'http';
    }
    $host = isset($_SERVER['HTTP_HOST']) ? trim((string)$_SERVER['HTTP_HOST']) : '';
    if ($host === '') {
        $host = 'tracker.tecclk.com';
    }
    return $scheme . '://' . $host;
}

function gd_backup_callback_url() {
    return gd_backup_current_origin() . '/Tracker/api/google-drive-auth-callback.php';
}

function gd_backup_settings_raw() {
    return gd_backup_read_json_file(gd_backup_settings_path(), []);
}

function gd_backup_load_settings() {
    $settings = gd_backup_settings_raw();
    $settings['client_secret'] = dialog_esms_resolve_secret(isset($settings['client_secret_encrypted']) ? $settings['client_secret_encrypted'] : ($settings['client_secret'] ?? ''));
    $settings['refresh_token'] = dialog_esms_resolve_secret(isset($settings['refresh_token_encrypted']) ? $settings['refresh_token_encrypted'] : ($settings['refresh_token'] ?? ''));
    return $settings;
}

function gd_backup_mask_value($value) {
    $raw = trim((string)$value);
    if ($raw === '') return '';
    if (strlen($raw) <= 8) return str_repeat('*', strlen($raw));
    return substr($raw, 0, 4) . str_repeat('*', max(0, strlen($raw) - 8)) . substr($raw, -4);
}

function gd_backup_sanitized_settings($settings) {
    $manifest = gd_backup_read_json_file(gd_backup_manifest_path(), []);
    return [
        'clientId' => (string)($settings['client_id'] ?? ''),
        'clientSecretMasked' => gd_backup_mask_value($settings['client_secret'] ?? ''),
        'folderId' => (string)($settings['folder_id'] ?? ''),
        'folderName' => (string)($settings['folder_name'] ?? GD_BACKUP_DEFAULT_ROOT_FOLDER),
        'sharedDriveId' => (string)($settings['shared_drive_id'] ?? ''),
        'connected' => trim((string)($settings['refresh_token'] ?? '')) !== '',
        'connectedEmail' => (string)($settings['connected_email'] ?? ''),
        'lastConnectedAt' => isset($settings['connected_at']) ? intval($settings['connected_at']) : 0,
        'lastFullBackupAt' => isset($manifest['lastFullBackupAt']) ? intval($manifest['lastFullBackupAt']) : 0,
        'lastFullBackupName' => (string)($manifest['lastFullBackupName'] ?? ''),
        'lastFullBackupFileId' => (string)($manifest['lastFullBackupFileId'] ?? ''),
    ];
}

function gd_backup_update_settings($incoming) {
    $existing = gd_backup_settings_raw();

    $clientId = trim((string)($incoming['clientId'] ?? ($existing['client_id'] ?? '')));
    $clientSecret = trim((string)($incoming['clientSecret'] ?? ''));
    $folderId = trim((string)($incoming['folderId'] ?? ($existing['folder_id'] ?? '')));
    $folderName = trim((string)($incoming['folderName'] ?? ($existing['folder_name'] ?? GD_BACKUP_DEFAULT_ROOT_FOLDER)));
    $sharedDriveId = trim((string)($incoming['sharedDriveId'] ?? ($existing['shared_drive_id'] ?? '')));

    $updated = $existing;
    $updated['client_id'] = $clientId;
    $updated['folder_id'] = $folderId;
    $updated['folder_name'] = $folderName !== '' ? $folderName : GD_BACKUP_DEFAULT_ROOT_FOLDER;
    $updated['shared_drive_id'] = $sharedDriveId;
    $updated['updated_at'] = intval(microtime(true) * 1000);

    if ($clientSecret !== '') {
        $updated['client_secret_encrypted'] = dialog_esms_encrypt_secret($clientSecret);
    }

    gd_backup_write_json_file(gd_backup_settings_path(), $updated);
    return gd_backup_load_settings();
}

function gd_backup_store_refresh_token($refreshToken, $connectedEmail = '') {
    $existing = gd_backup_settings_raw();
    $existing['refresh_token_encrypted'] = dialog_esms_encrypt_secret($refreshToken);
    $existing['connected_at'] = intval(microtime(true) * 1000);
    if ($connectedEmail !== '') {
        $existing['connected_email'] = $connectedEmail;
    }
    unset($existing['oauth_state']);
    unset($existing['oauth_return_to']);
    gd_backup_write_json_file(gd_backup_settings_path(), $existing);
}

function gd_backup_store_oauth_state($state, $returnTo) {
    $existing = gd_backup_settings_raw();
    $existing['oauth_state'] = $state;
    $existing['oauth_return_to'] = $returnTo;
    $existing['oauth_state_created_at'] = intval(microtime(true) * 1000);
    gd_backup_write_json_file(gd_backup_settings_path(), $existing);
}

function gd_backup_consume_oauth_state($state) {
    $existing = gd_backup_settings_raw();
    $expected = isset($existing['oauth_state']) ? (string)$existing['oauth_state'] : '';
    $returnTo = isset($existing['oauth_return_to']) ? (string)$existing['oauth_return_to'] : '/settings';
    $createdAt = isset($existing['oauth_state_created_at']) ? intval($existing['oauth_state_created_at']) : 0;
    $maxAgeMs = 15 * 60 * 1000;
    $isValid = $expected !== '' && hash_equals($expected, (string)$state) && $createdAt > 0 && (intval(microtime(true) * 1000) - $createdAt) <= $maxAgeMs;

    unset($existing['oauth_state']);
    unset($existing['oauth_return_to']);
    unset($existing['oauth_state_created_at']);
    gd_backup_write_json_file(gd_backup_settings_path(), $existing);

    return [
        'valid' => $isValid,
        'returnTo' => $returnTo !== '' ? $returnTo : '/settings',
    ];
}

function gd_backup_http_json($method, $url, $headers = [], $body = null) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = null;
    if (is_string($response) && $response !== '') {
        $decoded = json_decode($response, true);
    }

    return [
        'httpCode' => $httpCode,
        'raw' => is_string($response) ? $response : '',
        'data' => is_array($decoded) ? $decoded : null,
        'curlError' => $curlError,
    ];
}

function gd_backup_exchange_code_for_tokens($code, $clientId, $clientSecret) {
    $body = http_build_query([
        'code' => $code,
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'redirect_uri' => gd_backup_callback_url(),
        'grant_type' => 'authorization_code',
    ]);

    $result = gd_backup_http_json('POST', 'https://oauth2.googleapis.com/token', [
        'Content-Type: application/x-www-form-urlencoded',
    ], $body);

    if (!empty($result['curlError'])) {
        throw new Exception('Google token exchange failed: ' . $result['curlError']);
    }
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || !is_array($result['data'])) {
        $message = '';
        if (is_array($result['data']) && isset($result['data']['error_description'])) {
            $message = (string)$result['data']['error_description'];
        } elseif (is_array($result['data']) && isset($result['data']['error'])) {
            $message = (string)$result['data']['error'];
        }
        throw new Exception('Google token exchange failed' . ($message !== '' ? ': ' . $message : ''));
    }

    return $result['data'];
}

function gd_backup_refresh_access_token($settings) {
    $clientId = trim((string)($settings['client_id'] ?? ''));
    $clientSecret = trim((string)($settings['client_secret'] ?? ''));
    $refreshToken = trim((string)($settings['refresh_token'] ?? ''));

    if ($clientId === '' || $clientSecret === '' || $refreshToken === '') {
        throw new Exception('Google Drive backup is not connected');
    }

    $body = http_build_query([
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'refresh_token' => $refreshToken,
        'grant_type' => 'refresh_token',
    ]);

    $result = gd_backup_http_json('POST', 'https://oauth2.googleapis.com/token', [
        'Content-Type: application/x-www-form-urlencoded',
    ], $body);

    if (!empty($result['curlError'])) {
        throw new Exception('Google refresh token request failed: ' . $result['curlError']);
    }
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || empty($result['data']['access_token'])) {
        $message = '';
        if (is_array($result['data']) && isset($result['data']['error_description'])) {
            $message = (string)$result['data']['error_description'];
        } elseif (is_array($result['data']) && isset($result['data']['error'])) {
            $message = (string)$result['data']['error'];
        }
        throw new Exception('Google refresh token request failed' . ($message !== '' ? ': ' . $message : ''));
    }

    return (string)$result['data']['access_token'];
}

function gd_backup_drive_request($method, $url, $accessToken, $headers = [], $body = null) {
    $requestHeaders = array_merge([
        'Authorization: Bearer ' . $accessToken,
        'Accept: application/json',
    ], $headers);
    return gd_backup_http_json($method, $url, $requestHeaders, $body);
}

function gd_backup_drive_query_params($settings) {
    $params = [];
    $sharedDriveId = trim((string)($settings['shared_drive_id'] ?? ''));
    if ($sharedDriveId !== '') {
        $params['supportsAllDrives'] = 'true';
        $params['includeItemsFromAllDrives'] = 'true';
        $params['corpora'] = 'drive';
        $params['driveId'] = $sharedDriveId;
    }
    return $params;
}

function gd_backup_drive_list_files($settings, $accessToken, $query, $fields, $pageSize = 100) {
    $params = gd_backup_drive_query_params($settings);
    $params['q'] = $query;
    $params['fields'] = $fields;
    $params['pageSize'] = $pageSize;
    $url = 'https://www.googleapis.com/drive/v3/files?' . http_build_query($params);
    $result = gd_backup_drive_request('GET', $url, $accessToken);
    if (!empty($result['curlError'])) {
        throw new Exception('Failed to list Google Drive files: ' . $result['curlError']);
    }
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || !is_array($result['data'])) {
        $message = is_array($result['data']) && isset($result['data']['error']['message']) ? (string)$result['data']['error']['message'] : '';
        throw new Exception('Failed to list Google Drive files' . ($message !== '' ? ': ' . $message : ''));
    }
    return isset($result['data']['files']) && is_array($result['data']['files']) ? $result['data']['files'] : [];
}

function gd_backup_drive_find_folder($settings, $accessToken, $name, $parentId = '') {
    $escapedName = str_replace("'", "\\'", $name);
    $query = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='{$escapedName}'";
    if ($parentId !== '') {
        $query .= " and '{$parentId}' in parents";
    }
    $files = gd_backup_drive_list_files($settings, $accessToken, $query, 'files(id,name,parents)');
    return isset($files[0]) ? $files[0] : null;
}

function gd_backup_drive_create_folder($settings, $accessToken, $name, $parentId = '') {
    $metadata = [
        'name' => $name,
        'mimeType' => 'application/vnd.google-apps.folder',
    ];
    if ($parentId !== '') {
        $metadata['parents'] = [$parentId];
    }
    $params = gd_backup_drive_query_params($settings);
    $params['fields'] = 'id,name';
    $url = 'https://www.googleapis.com/drive/v3/files?' . http_build_query($params);
    $result = gd_backup_drive_request('POST', $url, $accessToken, [
        'Content-Type: application/json',
    ], json_encode($metadata));
    if (!empty($result['curlError'])) {
        throw new Exception('Failed to create Google Drive folder: ' . $result['curlError']);
    }
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || !is_array($result['data'])) {
        $message = is_array($result['data']) && isset($result['data']['error']['message']) ? (string)$result['data']['error']['message'] : '';
        throw new Exception('Failed to create Google Drive folder' . ($message !== '' ? ': ' . $message : ''));
    }
    return $result['data'];
}

function gd_backup_ensure_folder($settings, $accessToken, $name, $parentId = '') {
    $found = gd_backup_drive_find_folder($settings, $accessToken, $name, $parentId);
    if ($found && isset($found['id'])) {
        return $found;
    }
    return gd_backup_drive_create_folder($settings, $accessToken, $name, $parentId);
}

function gd_backup_resolve_root_folder($settings, $accessToken) {
    $folderId = trim((string)($settings['folder_id'] ?? ''));
    if ($folderId !== '') {
        return ['id' => $folderId, 'name' => (string)($settings['folder_name'] ?? GD_BACKUP_DEFAULT_ROOT_FOLDER)];
    }
    $folderName = trim((string)($settings['folder_name'] ?? GD_BACKUP_DEFAULT_ROOT_FOLDER));
    $folder = gd_backup_ensure_folder($settings, $accessToken, $folderName !== '' ? $folderName : GD_BACKUP_DEFAULT_ROOT_FOLDER);

    $raw = gd_backup_settings_raw();
    $raw['folder_id'] = isset($folder['id']) ? (string)$folder['id'] : '';
    $raw['folder_name'] = isset($folder['name']) ? (string)$folder['name'] : $folderName;
    gd_backup_write_json_file(gd_backup_settings_path(), $raw);

    return $folder;
}

function gd_backup_upload_file($settings, $accessToken, $parentId, $name, $mimeType, $bytes) {
    $boundary = 'tracker-backup-' . bin2hex(random_bytes(8));
    $metadata = ['name' => $name];
    if ($parentId !== '') {
        $metadata['parents'] = [$parentId];
    }

    $multipartBody = "--{$boundary}\r\n";
    $multipartBody .= "Content-Type: application/json; charset=UTF-8\r\n\r\n";
    $multipartBody .= json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\r\n";
    $multipartBody .= "--{$boundary}\r\n";
    $multipartBody .= "Content-Type: {$mimeType}\r\n\r\n";
    $multipartBody .= $bytes . "\r\n";
    $multipartBody .= "--{$boundary}--";

    $params = gd_backup_drive_query_params($settings);
    $params['uploadType'] = 'multipart';
    $params['fields'] = 'id,name,size,createdTime,webViewLink';
    $url = 'https://www.googleapis.com/upload/drive/v3/files?' . http_build_query($params);
    $result = gd_backup_drive_request('POST', $url, $accessToken, [
        'Content-Type: multipart/related; boundary=' . $boundary,
    ], $multipartBody);

    if (!empty($result['curlError'])) {
        throw new Exception('Failed to upload backup to Google Drive: ' . $result['curlError']);
    }
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || !is_array($result['data'])) {
        $message = is_array($result['data']) && isset($result['data']['error']['message']) ? (string)$result['data']['error']['message'] : '';
        throw new Exception('Failed to upload backup to Google Drive' . ($message !== '' ? ': ' . $message : ''));
    }
    return $result['data'];
}

function gd_backup_collect_server_json_files() {
    $dir = gd_backup_data_dir();
    $files = glob($dir . '/*.json');
    $collected = [];
    foreach ($files as $file) {
        $base = basename($file);
        if ($base === GD_BACKUP_SETTINGS_FILE || $base === GD_BACKUP_MANIFEST_FILE) {
            continue;
        }
        $contents = @file_get_contents($file);
        if (!is_string($contents)) {
            continue;
        }
        $decoded = json_decode($contents, true);
        $count = is_array($decoded) ? count($decoded) : 0;
        $collected[] = [
            'fileName' => $base,
            'path' => $file,
            'contents' => $contents,
            'count' => $count,
        ];
    }
    return $collected;
}

function gd_backup_create_full_snapshot_zip() {
    if (!class_exists('ZipArchive')) {
        throw new Exception('ZipArchive is not available on this server');
    }

    $files = gd_backup_collect_server_json_files();
    $timestamp = gmdate('Y-m-d\\TH-i-s\\Z');
    $tempPath = sys_get_temp_dir() . '/tracker-full-backup-' . uniqid('', true) . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($tempPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new Exception('Failed to create temporary backup archive');
    }

    $manifest = [
        'type' => 'full',
        'createdAt' => intval(microtime(true) * 1000),
        'createdAtIso' => gmdate('c'),
        'datasets' => [],
    ];

    foreach ($files as $file) {
        $zip->addFromString('data/' . $file['fileName'], $file['contents']);
        $manifest['datasets'][preg_replace('/\.json$/', '', $file['fileName'])] = [
            'file' => 'data/' . $file['fileName'],
            'count' => $file['count'],
        ];
    }

    $zip->addFromString('manifest.json', json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    $zip->close();

    return [
        'tempPath' => $tempPath,
        'fileName' => 'tracker-full-backup-' . $timestamp . '.zip',
        'manifest' => $manifest,
    ];
}

function gd_backup_update_manifest_after_full_backup($uploadedFile, $snapshotManifest) {
    $manifest = gd_backup_read_json_file(gd_backup_manifest_path(), []);
    $manifest['lastFullBackupAt'] = intval(microtime(true) * 1000);
    $manifest['lastFullBackupName'] = (string)($uploadedFile['name'] ?? '');
    $manifest['lastFullBackupFileId'] = (string)($uploadedFile['id'] ?? '');
    $manifest['lastFullBackupSize'] = isset($uploadedFile['size']) ? intval($uploadedFile['size']) : 0;
    $manifest['lastFullBackupCreatedTime'] = (string)($uploadedFile['createdTime'] ?? '');
    $manifest['lastFullBackupWebViewLink'] = (string)($uploadedFile['webViewLink'] ?? '');
    $manifest['lastSnapshotManifest'] = $snapshotManifest;
    gd_backup_write_json_file(gd_backup_manifest_path(), $manifest);
    return $manifest;
}

function gd_backup_list_full_backups($settings, $accessToken) {
    $root = gd_backup_resolve_root_folder($settings, $accessToken);
    $fullFolder = gd_backup_ensure_folder($settings, $accessToken, GD_BACKUP_FULL_SUBFOLDER, (string)$root['id']);
    $files = gd_backup_drive_list_files(
        $settings,
        $accessToken,
        "'" . $fullFolder['id'] . "' in parents and trashed=false",
        'files(id,name,size,createdTime,webViewLink),nextPageToken',
        100
    );
    usort($files, function ($a, $b) {
        return strcmp((string)($b['createdTime'] ?? ''), (string)($a['createdTime'] ?? ''));
    });
    return [
        'rootFolder' => $root,
        'fullFolder' => $fullFolder,
        'files' => $files,
    ];
}
