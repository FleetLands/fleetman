#!/usr/bin/env node

// Simple test script for FleetMan API endpoints
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('🧪 Testing FleetMan API endpoints...\n');

  // Test 1: Health check
  console.log('1. Testing health check endpoint...');
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    console.log(`   ✅ Health check: ${data.status}`);
    console.log(`   📅 Timestamp: ${data.timestamp}`);
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error.message}`);
  }

  // Test 2: Registration validation
  console.log('\n2. Testing registration validation...');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'a', password: 'b' })
    });
    const data = await response.json();
    if (data.message.includes('must be at least 3 characters')) {
      console.log('   ✅ Username length validation working');
    } else {
      console.log('   ❌ Username validation not working');
    }
  } catch (error) {
    console.log(`   ❌ Registration validation test failed: ${error.message}`);
  }

  // Test 3: Invalid username characters
  console.log('\n3. Testing username character validation...');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user@invalid', password: 'password' })
    });
    const data = await response.json();
    if (data.message.includes('can only contain letters, numbers, and underscores')) {
      console.log('   ✅ Username character validation working');
    } else {
      console.log('   ❌ Username character validation not working');
    }
  } catch (error) {
    console.log(`   ❌ Username character validation test failed: ${error.message}`);
  }

  // Test 4: Rate limiting
  console.log('\n4. Testing rate limiting...');
  let rateLimitHit = false;
  for (let i = 0; i < 6; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test' })
      });
      const data = await response.json();
      if (data.message.includes('Too many authentication attempts')) {
        rateLimitHit = true;
        break;
      }
    } catch (error) {
      // Ignore network errors for this test
    }
  }
  if (rateLimitHit) {
    console.log('   ✅ Rate limiting working');
  } else {
    console.log('   ❌ Rate limiting not working as expected');
  }

  // Test 5: Missing endpoints check
  console.log('\n5. Testing previously missing endpoints...');
  try {
    const statsResponse = await fetch(`${BASE_URL}/api/stats`);
    if (statsResponse.status !== 404) {
      console.log('   ✅ /api/stats endpoint exists');
    } else {
      console.log('   ❌ /api/stats endpoint still missing');
    }

    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (registerResponse.status !== 404) {
      console.log('   ✅ /api/auth/register endpoint exists');
    } else {
      console.log('   ❌ /api/auth/register endpoint still missing');
    }
  } catch (error) {
    console.log(`   ❌ Endpoint existence test failed: ${error.message}`);
  }

  console.log('\n🎉 API tests completed!');
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAPI().catch(console.error);
}

export { testAPI };