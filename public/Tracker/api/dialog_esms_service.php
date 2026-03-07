<?php

function dialog_esms_crypto_secret() {
    static $secret = null;
    if ($secret !== null) {
        return $secret;
    }

    $envCandidates = [
        getenv('TRACKER_SECRET_KEY'),
        getenv('APP_KEY'),
    ];

    foreach ($envCandidates as $candidate) {
        if (is_string($candidate) && trim($candidate) !== '') {
            $secret = trim($candidate);
            return $secret;
        }
    }

    $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : 'tracker.local';
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? (string)$_SERVER['DOCUMENT_ROOT'] : __DIR__;
    $secret = hash('sha256', 'tracker-esms-fallback|' . $host . '|' . $docRoot);
    return $secret;
}

function dialog_esms_encrypt_secret($plainText) {
    $plain = (string)$plainText;
    if ($plain === '') {
        return '';
    }
    if (strpos($plain, 'enc:v1:') === 0) {
        return $plain;
    }
    if (!function_exists('openssl_encrypt')) {
        return $plain;
    }

    $iv = function_exists('random_bytes') ? random_bytes(16) : openssl_random_pseudo_bytes(16);
    if (!is_string($iv) || strlen($iv) !== 16) {
        return $plain;
    }

    $key = hash('sha256', dialog_esms_crypto_secret(), true);
    $cipher = openssl_encrypt($plain, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    if ($cipher === false) {
        return $plain;
    }

    $token = rtrim(strtr(base64_encode($iv . $cipher), '+/', '-_'), '=');
    return 'enc:v1:' . $token;
}

function dialog_esms_decrypt_secret($storedValue) {
    $value = (string)$storedValue;
    if ($value === '') {
        return '';
    }
    if (strpos($value, 'enc:v1:') !== 0) {
        return $value;
    }
    if (!function_exists('openssl_decrypt')) {
        return '';
    }

    $payload = substr($value, 7);
    $padding = (4 - (strlen($payload) % 4)) % 4;
    $raw = base64_decode(strtr($payload . str_repeat('=', $padding), '-_', '+/'), true);
    if (!is_string($raw) || strlen($raw) <= 16) {
        return '';
    }

    $iv = substr($raw, 0, 16);
    $cipher = substr($raw, 16);
    $key = hash('sha256', dialog_esms_crypto_secret(), true);
    $plain = openssl_decrypt($cipher, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);

    return is_string($plain) ? $plain : '';
}

function dialog_esms_resolve_password($value) {
    $raw = (string)$value;
    if ($raw === '') {
        return '';
    }
    if (strpos($raw, 'enc:v1:') === 0) {
        return dialog_esms_decrypt_secret($raw);
    }
    return $raw;
}

function dialog_esms_http_post_json($url, $payload, $bearerToken = null) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

    $headers = [
        'Content-Type: application/json',
    ];
    if (!empty($bearerToken)) {
        $headers[] = 'Authorization: Bearer ' . $bearerToken;
    }

    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $data = null;
    if (is_string($response) && $response !== '') {
        $decoded = json_decode($response, true);
        if (is_array($decoded)) {
            $data = $decoded;
        }
    }

    return [
        'httpCode' => $httpCode,
        'raw' => is_string($response) ? $response : '',
        'data' => $data,
        'curlError' => $curlError,
    ];
}

function dialog_esms_http_get_json($url, $bearerToken = null) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);

    $headers = [
        'Accept: application/json',
    ];
    if (!empty($bearerToken)) {
        $headers[] = 'Authorization: Bearer ' . $bearerToken;
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $data = null;
    if (is_string($response) && $response !== '') {
        $decoded = json_decode($response, true);
        if (is_array($decoded)) {
            $data = $decoded;
        }
    }

    return [
        'httpCode' => $httpCode,
        'raw' => is_string($response) ? $response : '',
        'data' => $data,
        'curlError' => $curlError,
    ];
}

function dialog_esms_login($username, $password) {
    $result = dialog_esms_http_post_json(
        'https://e-sms.dialog.lk/api/v2/user/login',
        [
            'username' => $username,
            'password' => $password,
        ]
    );

    if (!empty($result['curlError'])) {
        throw new Exception('Connection error: ' . $result['curlError']);
    }

    $data = is_array($result['data']) ? $result['data'] : [];
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || empty($data['token'])) {
        $msg = '';
        if (isset($data['message']) && is_string($data['message'])) {
            $msg = $data['message'];
        }
        if ($msg === '') {
            $msg = 'Failed to authenticate with eSMS';
        }
        throw new Exception($msg);
    }

    return $data;
}

function dialog_esms_login_v3($username, $password) {
    $result = dialog_esms_http_post_json(
        'https://esms.dialog.lk/api/v3/user/login',
        [
            'username' => $username,
            'password' => $password,
        ]
    );

    if (!empty($result['curlError'])) {
        throw new Exception('V3 login connection error: ' . $result['curlError']);
    }

    $data = is_array($result['data']) ? $result['data'] : [];
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || empty($data['token'])) {
        $msg = '';
        if (isset($data['comment']) && is_string($data['comment'])) {
            $msg = $data['comment'];
        } elseif (isset($data['message']) && is_string($data['message'])) {
            $msg = $data['message'];
        }
        if ($msg === '') {
            $msg = 'Failed to authenticate with eSMS v3';
        }
        throw new Exception($msg);
    }

    return $data;
}

function dialog_esms_fetch_dashboard_wallet_balance($username, $password) {
    $userCandidates = [$username];
    if (substr($username, -4) !== '-web') {
        $userCandidates[] = $username . '-web';
    }

    $errors = [];

    foreach ($userCandidates as $candidateUser) {
        try {
            $login = dialog_esms_login_v3($candidateUser, $password);
            $token = isset($login['token']) ? trim((string)$login['token']) : '';
            if ($token === '') {
                $errors[] = 'V3 login returned empty token for user ' . $candidateUser;
                continue;
            }

            $dashboard = dialog_esms_http_get_json(
                'https://esms.dialog.lk/api/v1/account/user/dashboard',
                $token
            );

            if (!empty($dashboard['curlError'])) {
                $errors[] = 'Dashboard connection error for ' . $candidateUser . ': ' . $dashboard['curlError'];
                continue;
            }

            $data = is_array($dashboard['data']) ? $dashboard['data'] : [];
            $userData = isset($data['userData']) && is_array($data['userData']) ? $data['userData'] : [];
            $walletBalance = isset($userData['walletBalance']) ? $userData['walletBalance'] : null;

            if ($dashboard['httpCode'] >= 200 && $dashboard['httpCode'] < 300 && $walletBalance !== null && $walletBalance !== '') {
                return [
                    'walletBalance' => $walletBalance,
                    'username' => $candidateUser,
                    'raw' => $data,
                ];
            }

            $comment = isset($data['comment']) ? (string)$data['comment'] : '';
            $errors[] = 'Dashboard API returned no wallet balance for ' . $candidateUser . ($comment !== '' ? (': ' . $comment) : '');
        } catch (Exception $e) {
            $errors[] = 'Dashboard flow failed for ' . $candidateUser . ': ' . $e->getMessage();
        }
    }

    throw new Exception(implode(' | ', $errors));
}

function dialog_esms_normalize_mobile($mobile) {
    $normalized = preg_replace('/[^0-9]/', '', (string)$mobile);

    if (strpos($normalized, '94') === 0) {
        $normalized = substr($normalized, 2);
    } elseif (strpos($normalized, '0') === 0) {
        $normalized = substr($normalized, 1);
    }

    if (strlen($normalized) === 9 && strpos($normalized, '7') === 0) {
        return $normalized;
    }

    throw new Exception('Invalid mobile number format: ' . $mobile);
}

function dialog_esms_post_sms($token, $payload) {
    return dialog_esms_http_post_json('https://e-sms.dialog.lk/api/v2/sms', $payload, $token);
}

function dialog_esms_check_transaction($token, $transactionId) {
    return dialog_esms_http_post_json(
        'https://e-sms.dialog.lk/api/v2/sms/check-transaction',
        ['transaction_id' => $transactionId],
        $token
    );
}
