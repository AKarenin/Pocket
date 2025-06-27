# Production-Ready Pocket File Share

## ✨ Key Improvements

### 1. **Zero-Restart Architecture**
- **Dynamic Proxy Server**: Routes requests to share servers without tunnel restarts
- **Static Tunnel Configuration**: Tunnel points to proxy server, never needs reconfiguration
- **Hot-Swappable Shares**: Add/remove shares without any downtime

### 2. **Enhanced Stability**
- **Health Monitoring**: Automatic health checks every 30 seconds
- **Auto-Recovery**: Tunnel automatically restarts on failures (max 3 attempts)
- **Connection Pooling**: Better connection management with keepalive settings
- **Error Handling**: Comprehensive error handling throughout the application

### 3. **Share Deduplication**
- **Path-Based Deduplication**: Prevents multiple shares for the same folder
- **Automatic Cleanup**: Removes duplicate shares on startup
- **Smart Loading**: Only loads the most recent share for each path

### 4. **Production Configuration**
- **QUIC Protocol**: Uses QUIC for better performance
- **Optimized Timeouts**: 30s connect/TLS timeouts, 90s keepalive
- **Connection Limits**: 100 keepalive connections per ingress
- **Compression Disabled**: Better performance for binary files

## 🚀 Architecture Overview

```
Internet → Cloudflare Tunnel → Dynamic Proxy (port 8080) → Share Servers (50000-65000)
                ↑                      ↓
                └── Static Config      └── Dynamic Routing (no restarts!)
```

## 📋 Production Checklist

### Before Deployment:

1. **Cloudflare Setup**
   ```bash
   # Ensure tunnel is authenticated
   cloudflared tunnel login
   
   # Verify tunnel exists
   cloudflared tunnel list
   
   # Check DNS routing
   cloudflared tunnel route dns 442abcac-4aab-409f-854a-1c879870b60d "*.pocketfileshare.com"
   ```

2. **System Requirements**
   - Node.js 16+ 
   - 2GB RAM minimum
   - 100GB+ storage for shares
   - Stable internet connection

3. **Security**
   - ✅ 6-digit passcodes
   - ✅ Rate limiting (5 attempts per 5 minutes)
   - ✅ Path traversal protection
   - ✅ HTTPS-only access

## 🔧 Configuration

### Environment Variables
```bash
# Optional debug mode
export DEBUG=true

# Custom config path
export CONFIG_PATH=/path/to/production.json
```

### Production Config (`config/production.json`)
```json
{
  "tunnel": {
    "healthCheckInterval": 30000,    // Health check every 30s
    "maxRestartAttempts": 3,         // Max auto-restart attempts
    "restartDelay": 5000              // 5s delay between restarts
  },
  "shares": {
    "maxActiveShares": 100,           // Limit concurrent shares
    "sessionTimeout": 86400000        // 24h session timeout
  }
}
```

## 📊 Monitoring

### Health Indicators
- **Tunnel Status**: Check tunnel connection every 30 seconds
- **Active Shares**: Monitor share count and activity
- **Error Rates**: Track failed connections and restarts

### Logs
```bash
# View tunnel logs
tail -f ~/.cloudflared/*.log

# Application logs
npm run start 2>&1 | tee app.log
```

## 🚨 Troubleshooting

### Tunnel Connection Issues
1. **Timeout Errors**
   - Solution: Health monitor will auto-restart (up to 3 times)
   - Manual fix: `npm run restart-tunnel`

2. **DNS Not Resolving**
   - Check: `nslookup test.pocketfileshare.com`
   - Fix: Re-run DNS routing command

3. **Share Not Accessible**
   - Check proxy routes are updated
   - Verify share server is running
   - Check firewall settings

### Performance Optimization
1. **Disable Compression**: Already configured for better performance
2. **Use QUIC Protocol**: Enabled by default
3. **Connection Pooling**: 100 connections per ingress

## 🔐 Security Best Practices

1. **Regular Updates**
   ```bash
   # Update cloudflared
   brew upgrade cloudflared
   
   # Update dependencies
   npm update
   ```

2. **Access Control**
   - Change default passcodes immediately
   - Monitor access logs
   - Set share expiration times

3. **Backup Strategy**
   - Regular config backups
   - Share state persistence
   - Tunnel credential backup

## 📈 Scaling Considerations

### Current Limits
- **Single Machine**: ~100 concurrent shares
- **Bandwidth**: Limited by tunnel and internet connection
- **Storage**: Limited by local disk space

### Future Scaling
- Multiple tunnel instances for load balancing
- Distributed share servers
- CDN integration for static files
- Database for share metadata

## 🎯 Performance Metrics

- **Tunnel Startup**: ~5-10 seconds
- **Share Creation**: <1 second
- **Route Updates**: Instant (no restart)
- **Health Check**: Every 30 seconds
- **Auto-Recovery**: 5 second delay

## 🛠️ Maintenance

### Daily
- Check tunnel status
- Monitor active shares
- Review error logs

### Weekly
- Clean up old shares
- Update dependencies
- Check disk space

### Monthly
- Rotate logs
- Update cloudflared
- Security audit

## 📝 API Endpoints

### Share Management
- `GET /api/files` - List files (requires passcode)
- `GET /api/download` - Download file/folder
- `POST /api/verify` - Verify passcode

### Health Monitoring
- Tunnel status via IPC
- Share status via ShareManager
- Proxy status via DynamicProxy

## 🏆 Production Ready Features

✅ **No Downtime Updates** - Add/remove shares without tunnel restarts
✅ **Auto-Recovery** - Automatic tunnel restart on failures  
✅ **Health Monitoring** - Continuous health checks
✅ **Deduplication** - Prevents duplicate shares
✅ **Rate Limiting** - Protection against brute force
✅ **Error Handling** - Comprehensive error management
✅ **Optimized Config** - Production-tuned settings
✅ **Clean UI** - GitHub/Finder-style interface

## 💡 Tips

1. **Use systemd/launchd** for auto-start on boot
2. **Set up log rotation** to prevent disk fill
3. **Monitor bandwidth usage** to avoid limits
4. **Regular backups** of tunnel credentials
5. **Test failover** procedures regularly

---

This implementation is now **production-ready** for small to medium deployments (up to 100 concurrent users). For larger deployments, consider the scaling options mentioned above. 