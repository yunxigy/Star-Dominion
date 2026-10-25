# 北斗边坡多设备监测台

这是从原网站截取出来的 STM32/4G 云端上位机模块。它负责接收多台设备的定位、IMU、报警和温湿度数据，在地图上显示设备位置，并向指定设备下发指令。

当前目录是一个“可移植代码片段”，不是完整的前端工程：这里没有 `package.json`、Vite 配置和网站入口。迁移时需要把前端文件放回原网站工程，把 `4G.py` 部署到能够被设备访问的服务器上。

## 1. 功能概览

- 多台设备按数字 ID 独立保存状态。
- 每台设备在地图上显示独立标记和轨迹。
- 点击地图标记后，左侧面板同步切换到该设备。
- 所有设备选择器共用一个当前设备：UM980、IMU、ENU 位移、指令下发和 NMEA 监视器会同步切换。
- GNSS 位移由后端按设备处理：质量校验、固定参考点 ENU 转换和抗差自适应位置卡尔曼滤波。网页以厘米显示原始和滤波曲线，并标明参考建立、预测或过期状态。算法参数和更新步骤见 [GNSS 算法说明](4G/GNSS_ALGORITHM.md)。
- UM980 面板使用 8 个位置：经度、纬度、海拔、定位状态、卫星数、温度、湿度，以及云端预警设置。
- 预警由云端根据 JY901S 加速度 X/Y 和姿态角 X/Y/Z 的全局阈值计算，设备上报的旧 `ALARM:` 文本不会直接触发网页报警。
- 左侧数据栏固定在一个视口内，不使用纵向滚动，也不显示旧的左上角常驻报警卡片。
- NMEA/原始数据日志保存服务端接收时间，不会因为前端轮询而刷新旧日志时间。
- 指令只发送给当前选中的在线设备，不会广播给其他设备。

## 2. 目录结构

```text
wangye/
├─ README.md
├─ Stm32Window.tsx          # 监测台页面编排、数据连接和共享设备选择
├─ Stm32Page.tsx            # 原网站中的入口/跳转页，可按网站路由需要保留
├─ stm32/
│  ├─ MapSurface.tsx         # 高德地图、设备标记、轨迹和地图操作
│  ├─ LeftTelemetryDock.tsx  # 左侧数据栏
│  ├─ Um980Panel.tsx         # UM980 八格数据和预警入口
│  ├─ AlarmSettingsCard.tsx  # 全局云端预警设置弹窗
│  ├─ alarmSettings.ts       # 阈值归一化和启用状态
│  ├─ ImuPanel.tsx           # IMU 数据
│  ├─ DisplacementPanel.tsx  # ENU 原始与滤波位移曲线
│  ├─ AlertStack.tsx         # 旧组件，保留但新页面不渲染
│  ├─ CommandPanel.tsx       # 指令下发
│  ├─ NmeaPanel.tsx           # 原始数据/NMEA 监视器
│  ├─ NotificationPanel.tsx  # 系统通知
│  ├─ DeviceSelector.tsx     # 共享设备选择器
│  ├─ telemetry.ts           # 消息解析和设备快照归一化
│  └─ types.ts               # 前端共享类型
├─ 4G/
│  ├─ 4G.py                  # Flask + WebSocket + TCP 服务
│  ├─ gnss_filter.py         # 按设备保存参考与状态的 GNSS 处理模块
│  ├─ GNSS_ALGORITHM.md      # 当前算法参数与部署说明
│  ├─ requirements.txt       # Python 依赖
│  └─ tests/                 # 后端协议和多设备测试
└─ tests/                    # 前端源码契约测试
```

不要把 `4G/__pycache__/` 和测试缓存目录部署到服务器。测试目录可以保留在开发环境中，用于迁移后的回归检查。

## 3. 数据流和端口

```text
STM32/4G 模块
      │ TCP :8008
      ▼
   4G.py
      ├─ GET /data       ─────┐
      ├─ WebSocket /ws       ├─ 网站前端 Stm32Window
      ├─ GET /send_cmd  ◄────┘
      └─ GET/PUT /alarm-settings ◄── 全局预警标准
```

默认端口：

| 服务 | 默认端口 | 用途 |
|---|---:|---|
| HTTP/WebSocket | `8007` | 网站读取数据、建立 WebSocket、下发指令 |
| 设备 TCP | `8008` | 4G 模块连接并上传设备数据 |

可以通过环境变量修改端口：

```powershell
$env:STM32_HTTP_PORT = "8007"
$env:STM32_TCP_PORT = "8008"
```

## 4. 把前端移回原网站

### 4.1 复制文件

把以下内容复制到原网站的前端源码目录，并保持相对路径不变：

```text
Stm32Window.tsx
stm32/
```

例如原网站使用 `src/pages/stm32/`：

```text
原网站/src/pages/stm32/
├─ Stm32Window.tsx
└─ stm32/
   ├─ MapSurface.tsx
   ├─ Um980Panel.tsx
   ├─ ImuPanel.tsx
   ├─ DisplacementPanel.tsx
   ├─ LeftTelemetryDock.tsx
   ├─ AlertStack.tsx
   ├─ CommandPanel.tsx
   ├─ NmeaPanel.tsx
   ├─ NotificationPanel.tsx
   ├─ DeviceSelector.tsx
   ├─ telemetry.ts
   └─ types.ts
```

`Stm32Window.tsx` 使用 `./stm32/...` 引用组件，所以不要只复制主文件，也不要把 `stm32` 目录改名。

### 4.2 安装前端依赖

在原网站工程根目录执行。React、ReactDOM 和 Tailwind 如果原网站已经使用，就不需要重复安装。

```powershell
npm install lucide-react framer-motion recharts @amap/amap-jsapi-loader
```

页面使用 Tailwind CSS 类名。原网站必须已经配置 Tailwind，且扫描范围要包含迁移后的 `.tsx` 文件，例如：

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
};
```

### 4.3 注册页面路由

如果原网站使用 React Router，可以直接把 `Stm32Window` 作为监测台页面：

```tsx
import Stm32Window from './pages/stm32/Stm32Window';

// 示例
<Route path="/stm32" element={<Stm32Window />} />
```

`Stm32Page.tsx` 是旧的入口/跳转页，不是新的地图监测台。若希望网站菜单直接进入监测台，请将菜单路由指向 `Stm32Window`；若网站仍通过独立 `/stm32/` 页面加载监测台，可以继续保留 `Stm32Page` 作为入口。

## 5. 地图配置

在原网站前端工程根目录创建 `.env.local`，填入高德 Web JS API 的 Key 和安全密钥：

```dotenv
VITE_AMAP_KEY=你的高德Web端Key
VITE_AMAP_SECURITY_CODE=你的高德安全密钥
```

修改环境变量后必须重启前端开发服务器。没有配置时，页面仍会显示深蓝面板，但地图组件会在系统通知中提示地图未配置。

生产环境构建时，请确保这两个 `VITE_` 变量在构建环境中可用；Vite 会在构建时把它们写入前端资源。

## 6. 后端安装和启动

### Windows PowerShell

```powershell
cd wangye/4G
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python .\4G.py
```

启动成功后，服务会监听：

```text
HTTP / WebSocket server starting on port 8007
4G TCP server started on port 8008
```

### Linux

```bash
cd wangye/4G
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python 4G.py
```

不要使用 Flask 开发服务器替代 `python 4G.py`。`4G.py` 启动时还会创建设备 TCP 服务和 WebSocket 服务。

更新时同时替换 `4G.py` 和 `gnss_filter.py`，保留 `gnss_runtime/` 持久化目录；可用 `STM32_GNSS_STATE_DIR` 指定目录。每个设备只由一个后端实例计算状态，浏览器共享计算结果。刷新网页或清除地图轨迹不会改变位移零点。

## 7. 网站反向代理

前端会根据当前页面路径自动选择 API 前缀：

| 页面地址 | 前端请求地址 |
|---|---|
| `/stm32` 或其他普通网站路径 | `/api/data`、`/api/ws`、`/api/send_cmd` |
| 路径中包含 `/stm32` 的独立页面 | `/stm32/api/data`、`/stm32/api/ws`、`/stm32/api/send_cmd` |

生产环境推荐使用同源反向代理。以 Nginx 为例，如果网站页面使用 `/stm32` 路径：

```nginx
location /stm32/api/ {
    proxy_pass http://127.0.0.1:8007/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

如果页面使用普通 `/api` 前缀，把 location 改为：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8007/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

`proxy_pass` 末尾的 `/` 不要省略。它负责把 `/api/data` 转发成后端的 `/data`，把 `/api/ws` 转发成后端的 `/ws`。

开发环境也需要配置代理。以 Vite 为例：

```ts
// vite.config.ts，示意
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8007',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
```

如果开发页面路径包含 `/stm32`，请额外为 `/stm32/api` 配置代理，或者把页面改为普通 `/api` 前缀访问。

## 8. 设备上行协议

### 8.1 设备 ID

每台设备必须使用唯一的纯数字 ID。推荐设备建立 TCP 连接后先发送一行 ID：

```text
1
```

之后发送的每一行都带 ID，格式为：

```text
设备ID,原始数据
```

例如：

```text
1,$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M,-3.7,M,63.0,0*7A
1,ACC: 0.214 0.068 -0.979 g
1,ANGLE: -0.604 -0.742 -17.820 deg
1,TEMP: 23.6 C HUM: 58.4 %RH
```

如果设备使用当前固件的 `USART1_4G_printf`，每一行会自动添加设备 ID。烧录不同设备前，修改：

```c
// USER/USART1_4G.h
#define DEVICE_ID 1U
```

每台设备必须烧录不同的 `DEVICE_ID`。

### 8.2 当前支持的数据行

后端会接收并解析以下数据：

```text
ACC: x y z g
GYRO: x y z deg/s
ANGLE: x y z deg
$GNGGA,...
ALARM: level=YELLOW score=20.0 D=0.00mm V=0.00mm/min E=0.00mm N=0.00mm U=0.00mm tilt=14.82deg accDyn=0.004g q=4 sats=26
TEMP: 23.6 C HUM: 58.4 %RH
```

温度单位是 `°C`，湿度单位是 `%RH`。设备未上报温湿度时，前端显示 `--`。

### 8.3 在线判断

设备最后一条有效数据距当前时间小于 5 秒时显示为在线；超过 5 秒后显示为离线。离线设备仍保留最后一次有效位置和数据，地图标记会变为灰色。

## 9. 后端接口

后端原始接口路径如下。网站通常通过 `/api` 或 `/stm32/api` 反向代理访问。

### `GET /data`

返回所有设备的完整快照：

```json
{
  "devices": {
    "1": {
      "device_id": "1",
      "online": true,
      "latitude": 36.810429,
      "longitude": 117.993472,
      "altitude": 35.3192,
      "quality": "RTK 固定解",
      "quality_code": "4",
      "satellites": 26,
      "temperature": 23.6,
      "humidity": 58.4,
      "server_timestamp": 1710000000000,
      "messages": []
    }
  },
  "server_timestamp": 1710000001000
}
```

实际响应还包含 IMU、报警、数据年龄和原始消息等字段。前端使用 `device_id` 作为设备唯一键，不要在网站层把多台设备合并成单个 `data` 对象。

### `WebSocket /ws`

WebSocket 推送与 `/data` 相同结构的设备快照。前端同时保留每秒一次的 `/data` 轮询作为断线或推送异常时的兜底，因此不要在网站代理层关闭 WebSocket Upgrade。

### `GET /alarm-settings`

读取所有用户共用的云端预警标准：

```json
{
  "settings": {
    "acc_x": 0.8,
    "acc_y": null,
    "angle_x": null,
    "angle_y": null,
    "angle_z": 30.0
  },
  "updated_at_ms": 1710000000000,
  "revision": 3
}
```

### `PUT /alarm-settings`

保存新的全局标准。五个字段均可填非负数字；留空或传 `null` 表示关闭该项。任意一个已启用字段达到阈值就报警，判断使用绝对值，例如 `-0.85 g` 会触发 `0.8 g`，`-31°` 会触发 `30°`。设置会原子写入 `4G/alarm_settings.json`，服务重启后仍保留；也可以用 `STM32_ALARM_SETTINGS_PATH` 指定保存位置。

保存后会立即重新计算所有设备，并通过 WebSocket 推送给所有打开的页面。
响应中的 `revision` 用于页面忽略乱序返回的旧设置。

### `GET /send_cmd`

向指定在线设备发送指令：

```text
/send_cmd?device_id=12&cmd=0
```

后端会把 `0\r\n` 发送给设备 ID 为 `12` 的 TCP 连接。

常见返回：

| HTTP 状态 | 含义 |
|---:|---|
| `200` | 指令已发送到目标设备 |
| `400` | 缺少设备 ID，或设备 ID 不是纯数字 |
| `409` | 设备不存在、离线、没有绑定 TCP 连接或发送失败 |

## 10. 跨域配置

如果网站和 `4G.py` 使用同一个域名并通过反向代理访问，不需要额外配置跨域。

如果前端直接访问 `8007`，需要设置允许的前端 Origin：

```powershell
$env:STM32_ALLOWED_ORIGINS = "http://localhost:5173,https://your-site.example.com"
python .\4G.py
```

不要把 `*` 作为生产环境允许来源。默认允许来源包括本地 `8013` 和 `8014` 端口。

## 11. 迁移后的验证清单

### 后端检查

```powershell
cd wangye
py -m py_compile .\4G\4G.py
py -m pytest -q
```

### 浏览器检查

1. 打开 `/stm32` 页面，确认地图铺满背景，左右面板浮在地图上。
2. 确认页面能请求 `/api/data` 或 `/stm32/api/data`，返回 `devices` 对象。
3. 用两台设备发送不同 ID 的 GNGGA，确认地图同时显示两个标记。
4. 点击任意标记，确认定位状态、卫星数、IMU、位移、NMEA 和指令目标同步切换。
5. 在任意一个设备选择器切换设备，确认其他选择器同步变化。
6. 发送指令后，确认只有选中设备收到数据。
7. 重复轮询同一条数据，确认 NMEA 旧记录的时间不变化。
8. 让设备停止上报超过 5 秒，确认它变为离线但最后位置仍保留。
9. 打开 UM980 第二排第四格“预警设置”，填写任意阈值并保存；确认所有页面使用同一标准，低于全部阈值后报警自动清除。

### 两台设备测试数据

```text
1,$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M,-3.7,M,63.0,0*7A
1,ACC: 0.214 0.068 -0.979 g
12,$GNGGA,094555.00,3648.72575231,N,11759.70830819,E,5,18,0.9,40.0000,M,-3.7,M,63.0,0*7A
12,ACC: 0.314 0.168 -0.879 g
```

## 12. 常见问题

### 页面显示“地图未配置”

检查原网站构建环境中的 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_CODE`，修改后重启前端服务。不要只修改服务器运行时环境，因为 Vite 变量通常在构建阶段注入。

### 页面没有设备数据

依次检查：

1. `4G.py` 是否监听 `8007` 和 `8008`。
2. 浏览器请求路径是否与页面路径匹配：`/api/*` 或 `/stm32/api/*`。
3. `GET /data` 是否返回 `devices`。
4. 设备是否先发送纯数字 ID，或每行是否带有正确的 `设备ID,` 前缀。
5. 设备 ID 是否被其他 TCP 连接重复占用。

### 指令返回 `409`

目标设备当前没有有效 TCP 连接，或者最后一次上报已经超过 5 秒。确认设备在线并重新发送。

### NMEA 时间仍然不断变化

检查网站是否仍在加载旧版 `Stm32Window`，以及新页面是否使用 `NmeaPanel.tsx`。新版本日志必须包含 `server_timestamp`，渲染时使用保存的 `entry.timestamp`，不能在 JSX 中调用当前时间。

## 13. 部署边界

- 前端：将 `Stm32Window.tsx` 和整个 `stm32/` 目录并入原网站工程，并由原网站负责构建和发布。
- 后端：将 `wangye/4G/` 部署到能被设备访问的服务器，开放设备 TCP 端口 `8008`，仅向网站开放 HTTP/WebSocket 端口 `8007`。
- 地图：在前端构建环境配置高德 Key 和安全密钥。
- 设备：每台硬件烧录唯一数字 `DEVICE_ID`，并保证每行上报数据带 ID。
