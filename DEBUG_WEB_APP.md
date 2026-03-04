# Web App Debugging Guide

## Issue Summary
The web app opens slowly and buttons are not clickable.

## Root Cause Analysis

### Identified Issues:

1. **Backend Dependency**: The app is running with `EXPO_PUBLIC_ENABLE_VPS_BACKEND=true`, which means it's trying to connect to the backend at `http://localhost:4000`

2. **Potential PostgreSQL Connection Issue**: The backend requires PostgreSQL to be running:
   - Database: `wiseplan`
   - Connection string in `backend/.env`: `postgres://postgres:m745qBHhM8c8@localhost:5432/wiseplan`

3. **Authentication State**: The app might be stuck in the `isRestoringSession` state if there's an issue with AsyncStorage/localStorage

4. **Slow Load**: Backend API calls have 12-second timeouts. If the backend isn't responding, the app will be slow to load.

## Diagnostic Steps

### Step 1: Check if PostgreSQL is Running

```powershell
# Windows: Check if PostgreSQL service is running
Get-Service postgresql*
# Or
psql -U postgres -d wiseplan -c "SELECT version();"
```

### Step 2: Check if Backend is Running

Open http://localhost:4000/healthz in your browser. You should see:
```json
{
  "ok": true,
  "service": "wiseplan-backend",
  "authMode": "dev"
}
```

If you get an error or timeout, the backend is not running.

### Step 3: Check Browser Console for Errors

1. Open your web app at http://localhost:8081
2. Press F12 to open Developer Tools
3. Go to Console tab
4. Look for errors (especially CORS, network, or React errors)
5. Check Network tab for failed API requests

### Step 4: Check if App is Stuck in Loading State

Look at the Network tab in browser DevTools:
- Are there pending requests to `localhost:4000` that are timing out?
- Are there any failed requests?

## Quick Fixes

### Fix 1: Start Backend Properly

Make sure PostgreSQL is running, then:

```powershell
cd backend
npm run build
npm run migrate
npm start
```

Wait until you see: `wiseplan-backend listening on http://localhost:4000`

### Fix 2: Run Without Backend (Faster Debugging)

If you don't need backend features yet, run the app without backend:

```powershell
# Instead of: npm run web:backend
# Use:
npm run web
```

This will skip all backend API calls and make the app load faster.

### Fix 3: Clear Browser Storage

The app might have corrupted data in localStorage:

1. Open browser DevTools (F12)
2. Go to Application tab
3. Expand "Local Storage"
4. Click on your app's origin (http://localhost:8081)
5. Click "Clear All" button
6. Refresh the page

### Fix 4: Check PostgreSQL Database

```powershell
# Connect to PostgreSQL
psql -U postgres

# Check if database exists
\l

# If wiseplan database doesn't exist, create it:
CREATE DATABASE wiseplan;

# Exit
\q
```

## Expected Startup Process

When you run `start_be_admin_app.bat`, it should:

1. Run backend migrations (creates database tables)
2. Start backend server on port 4000
3. Start admin panel on port 5175
4. Start Expo web app on port 8081

Each should open in a separate CMD window.

## Common Issues

### Issue: "Cannot connect to PostgreSQL"
**Solution**: Install and start PostgreSQL service:
```powershell
# Start PostgreSQL service
net start postgresql-x64-14
```

### Issue: "Port 4000 already in use"
**Solution**: Kill the process using port 4000:
```powershell
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

### Issue: "App loads but nothing is clickable"
**Possible causes**:
1. JavaScript error preventing event handlers from attaching
2. CSS overlay blocking clicks
3. React still in loading/suspended state

**Solution**: Check browser console for JavaScript errors

### Issue: "CORS error in browser console"
**Solution**: Backend has CORS enabled, but if you see CORS errors:
- Make sure backend is running
- Check that `EXPO_PUBLIC_BACKEND_API_URL` matches the actual backend URL

## Testing Plan

1. **Test Backend Only**:
   ```powershell
   cd backend
   npm run dev
   # Visit http://localhost:4000/healthz
   ```

2. **Test Frontend Without Backend**:
   ```powershell
   npm run web
   # App should work without backend features
   ```

3. **Test Full Stack**:
   ```powershell
   .\start_be_admin_app.bat
   # Wait for all services to start
   # Visit http://localhost:8081
   ```

## Next Steps

1. Run through diagnostic steps above
2. Share the output from browser console (F12 → Console tab)
3. Share any error messages from the backend CMD window
4. Let me know which fix worked or if you need more help

## Additional Notes

- Backend uses `AUTH_MODE=dev` which bypasses authentication for local development
- Admin panel is on http://localhost:5175
- Google Geocoding API key is present in backend/.env (for premium features)
