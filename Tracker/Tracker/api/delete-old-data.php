<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!isset($input['userId']) || !isset($input['dataType']) || !isset($input['cutoffDate'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields: userId, dataType, cutoffDate']);
    exit;
}

$userId = $input['userId'];
$dataType = $input['dataType'];
$cutoffDate = intval($input['cutoffDate']);

$filename = __DIR__ . '/' . $dataType . '_' . $userId . '.json';

if (!file_exists($filename)) {
    echo json_encode(['success' => true, 'deleted' => 0, 'message' => 'No data file exists']);
    exit;
}

try {
    $jsonData = file_get_contents($filename);
    $data = json_decode($jsonData, true);
    
    if (!is_array($data)) {
        echo json_encode(['success' => false, 'error' => 'Invalid data format']);
        exit;
    }
    
    $originalCount = count($data);
    
    // Filter out items older than cutoffDate
    // Keep items that are:
    // 1. Newer than cutoffDate (updatedAt >= cutoffDate)
    // 2. OR have no updatedAt field (keep for safety)
    // 3. OR are not marked as deleted (deleted !== true)
    $filteredData = array_values(array_filter($data, function($item) use ($cutoffDate) {
        // Keep items without updatedAt
        if (!isset($item['updatedAt'])) {
            return true;
        }
        
        // Keep items that are newer than cutoff
        if (intval($item['updatedAt']) >= $cutoffDate) {
            return true;
        }
        
        // For old items, only keep if not deleted
        // This ensures we only delete items that are both old AND marked as deleted
        if (!isset($item['deleted']) || $item['deleted'] !== true) {
            return true;
        }
        
        // Item is old AND deleted, so remove it
        return false;
    }));
    
    $deletedCount = $originalCount - count($filteredData);
    
    if ($deletedCount > 0) {
        // Write the filtered data back to the file
        $jsonOutput = json_encode($filteredData, JSON_PRETTY_PRINT);
        file_put_contents($filename, $jsonOutput);
        
        echo json_encode([
            'success' => true,
            'deleted' => $deletedCount,
            'remaining' => count($filteredData),
            'message' => "Deleted $deletedCount old items from $dataType"
        ]);
    } else {
        echo json_encode([
            'success' => true,
            'deleted' => 0,
            'remaining' => count($filteredData),
            'message' => 'No old data to delete'
        ]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Failed to process data: ' . $e->getMessage()
    ]);
}
