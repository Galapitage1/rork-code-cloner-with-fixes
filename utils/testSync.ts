export async function testServerConnection(): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> {
  const baseUrl = 'https://tracker.tecclk.com';
  
  console.log('=== Testing Server Connection ===');
  console.log('Base URL:', baseUrl);
  
  try {
    console.log('Test 1: Checking PHP API health...');
    const response = await fetch(`${baseUrl}/Tracker/api/get.php?endpoint=users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      return {
        success: false,
        message: `Server returned status ${response.status}`,
        details: {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        },
      };
    }
    
    const data = await response.json();
    console.log('Response data:', data);
    
    return {
      success: true,
      message: 'Successfully connected to PHP sync API',
      details: {
        status: response.status,
        dataLength: Array.isArray(data) ? data.length : 0,
      },
    };
  } catch (error: any) {
    console.error('Connection test failed:', error);
    return {
      success: false,
      message: error.message || 'Failed to connect',
      details: {
        error: error.name,
        message: error.message,
      },
    };
  }
}

export async function testWriteToServer(): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> {
  const baseUrl = 'https://tracker.tecclk.com';
  
  console.log('=== Testing Server Write ===');
  
  try {
    const testData = [{
      id: 'test-' + Date.now(),
      name: 'Test Item',
      updatedAt: Date.now(),
    }];
    
    console.log('Sending test data:', testData);
    
    const response = await fetch(`${baseUrl}/Tracker/api/sync.php?endpoint=test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `Write failed with status ${response.status}`,
        details: {
          status: response.status,
          errorText,
        },
      };
    }
    
    const result = await response.json();
    console.log('Write result:', result);
    
    return {
      success: true,
      message: 'Successfully wrote to server',
      details: {
        writtenItems: Array.isArray(result) ? result.length : 0,
      },
    };
  } catch (error: any) {
    console.error('Write test failed:', error);
    return {
      success: false,
      message: error.message || 'Failed to write',
      details: {
        error: error.name,
        message: error.message,
      },
    };
  }
}
