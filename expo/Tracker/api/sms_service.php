<?php
function send_sms_esms($mobiles, $message, $transactionId) {
    $smsApiUrl = 'https://app.notify.lk/api/v1/send';
    $smsApiKey = '';
    
    $settingsFile = __DIR__ . '/../../../campaign_settings.json';
    if (file_exists($settingsFile)) {
        $settings = json_decode(file_get_contents($settingsFile), true);
        if (isset($settings['smsApiUrl'])) {
            $smsApiUrl = $settings['smsApiUrl'];
        }
        if (isset($settings['smsApiKey'])) {
            $smsApiKey = $settings['smsApiKey'];
        }
    }
    
    if (empty($smsApiKey)) {
        throw new Exception('SMS API key not configured');
    }
    
    $results = [
        'success' => 0,
        'failed' => 0,
        'errors' => [],
    ];
    
    foreach ($mobiles as $mobile) {
        $mobile = preg_replace('/[^0-9]/', '', $mobile);
        
        if (substr($mobile, 0, 1) === '0') {
            $mobile = '94' . substr($mobile, 1);
        } elseif (substr($mobile, 0, 2) !== '94') {
            $mobile = '94' . $mobile;
        }
        
        $payload = json_encode([
            'user_id' => '11217',
            'api_key' => $smsApiKey,
            'sender_id' => 'NotifyDEMO',
            'to' => $mobile,
            'message' => $message,
        ]);
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $smsApiUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$smsApiKey}",
            'Content-Type: application/json',
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($curlError) {
            $results['failed']++;
            $results['errors'][] = "{$mobile}: {$curlError}";
            continue;
        }
        
        $data = json_decode($response, true);
        
        if ($httpCode !== 200 || (isset($data['status']) && $data['status'] !== 'success')) {
            $errorMsg = isset($data['message']) ? $data['message'] : 'Failed to send SMS';
            $results['failed']++;
            $results['errors'][] = "{$mobile}: {$errorMsg}";
        } else {
            $results['success']++;
        }
        
        usleep(500000);
    }
    
    return [
        'status' => ($results['failed'] === 0) ? 'success' : 'partial',
        'message' => "Sent: {$results['success']}, Failed: {$results['failed']}",
        'results' => $results,
    ];
}
