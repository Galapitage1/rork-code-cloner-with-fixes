export async function testServerConnection(): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> {
  const baseUrl = 'https://tracker.tecclk.com';
  
  try {
    const response = await fetch(`${baseUrl}/Tracker/api/get.php?endpoint=users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
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
    
    return {
      success: true,
      message: 'Successfully connected to PHP sync API',
      details: {
        status: response.status,
        dataLength: Array.isArray(data) ? data.length : 0,
      },
    };
  } catch (error: any) {
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
  
  try {
    const testData = [{
      id: 'test-' + Date.now(),
      name: 'Test Item',
      updatedAt: Date.now(),
    }];
    
    const response = await fetch(`${baseUrl}/Tracker/api/sync.php?endpoint=test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    });
    
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
    
    return {
      success: true,
      message: 'Successfully wrote to server',
      details: {
        writtenItems: Array.isArray(result) ? result.length : 0,
      },
    };
  } catch (error: any) {
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
