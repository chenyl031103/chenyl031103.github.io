#!/bin/bash
# 自动把 GitHub Pages 跳转页里的 Cloudflare 备用地址换成当前地址
# （跳转页会依次探测主入口和备用入口，这里只刷新 Cloudflare 候选地址）
cd /c/Users/Administrator/ZCodeProject/guild-redirect

# 取当前 Cloudflare 隧道地址
CF_URL=$(curl -s http://localhost:3000/tunnel_url.txt)
if [ -z "$CF_URL" ] || [[ ! "$CF_URL" =~ ^https:// ]]; then
  echo "Failed to get CF URL"
  exit 1
fi

# 当前页面里已有的 Cloudflare 地址
CURRENT=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' index.html | head -1)
if [ "$CF_URL" = "$CURRENT" ]; then
  echo "No change: $CF_URL"
  exit 0
fi

if [ -z "$CURRENT" ]; then
  echo "No trycloudflare URL found in index.html"
  exit 1
fi

# 替换候选列表里的 Cloudflare 地址
sed -i "s|$CURRENT|$CF_URL|g" index.html

git add index.html
git commit -m "Update CF URL: $CF_URL"
git push origin main 2>&1
echo "Updated: $CF_URL"
