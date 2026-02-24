<?php

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

