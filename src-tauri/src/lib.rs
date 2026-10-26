//! Style Skill 桌面主进程。
//!
//! 职责（详见 docs/tauri-integration-plan.md）：
//! - 启动时选择空闲端口，以子进程拉起 Python 推理服务
//!   （复用 inference/screenparser_server.py，仅绑定 127.0.0.1）
//! - 健康检查（轮询 /health，30s 超时），失败则降级——
//!   应用继续运行，前端走「识别服务不可用」路径，Canvas 分析不受影响
//! - 窗口销毁 / 进程 Drop 时终止子进程
//! - 对前端只暴露一个只读命令：detect_server_url()
//!
//! 注意：本脚手架尚未编译验证（开发机缺少 Rust/MSVC 工具链）。

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, State};

/// 健康检查最长等待时间
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
/// 健康检查轮询间隔
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);

struct DetectServer {
    child: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
}

impl Drop for DetectServer {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 选择一个空闲端口：先绑定 127.0.0.1:0 再释放。
/// 存在极小的竞争窗口，Python 端绑定失败会退出，由健康检查兜底。
fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

/// Python 解释器定位：
/// 1. 发布模式：<exe_dir>/runtime/python.exe（便携包内置）
/// 2. 开发模式：STYLE_SKILL_DEV_ROOT 指向项目根时，
///    使用 poc/screenparser-poc/.venv（与 npm run detect:server 一致）
fn resolve_python() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let bundled = exe
            .parent()?
            .join("runtime")
            .join("python.exe");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    if let Ok(dev_root) = std::env::var("STYLE_SKILL_DEV_ROOT") {
        let dev_python = PathBuf::from(dev_root)
            .join("poc")
            .join("screenparser-poc")
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        if dev_python.is_file() {
            return Some(dev_python);
        }
    }
    None
}

/// 推理服务脚本定位：发布资源目录 → 开发模式项目根
fn resolve_server_script() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let bundled = exe
            .parent()?
            .join("resources")
            .join("inference")
            .join("screenparser_server.py");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    if let Ok(dev_root) = std::env::var("STYLE_SKILL_DEV_ROOT") {
        let dev_script = PathBuf::from(dev_root)
            .join("inference")
            .join("screenparser_server.py");
        if dev_script.is_file() {
            return Some(dev_script);
        }
    }
    None
}

/// 启动推理服务并等待健康检查通过；任何失败返回 None（应用降级运行）。
fn start_detect_server() -> Option<(Child, String)> {
    let port = pick_free_port()?;
    let python = resolve_python()?;
    let script = resolve_server_script()?;

    // 模型路径：发布模式优先 resources/models/best.onnx（默认 ONNX 后端）。
    // 服务端自身也会回退到环境变量与开发模式路径；如需 PyTorch 回退，
    // 设置 SCREENPARSER_BACKEND=pytorch 与 SCREENPARSER_MODEL
    let mut command = Command::new(python);
    command
        .arg(&script)
        .arg("--port")
        .arg(port.to_string());

    // Windows：python.exe 是控制台子系统程序，GUI 父进程直接拉起会弹黑窗口；
    // CREATE_NO_WINDOW (0x0800_0000) 抑制控制台创建，不改变子进程行为
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    // 日志重定向到文件（追加）：保留错误诊断信息，且不会因管道未读取而阻塞子进程；
    // 每次应用启动时截断，避免无限增长。日志放在系统临时目录，
    // 避免便携目录/Program Files 的写权限问题。
    let log_path = std::env::temp_dir().join("style-skill-detect.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .ok();
    match log_file {
        Some(file) => {
            let stderr = file.try_clone().ok()?;
            command.stdout(std::process::Stdio::from(file));
            command.stderr(std::process::Stdio::from(stderr));
        }
        None => {
            // 日志文件打不开（极端情况）时不阻断启动，丢弃输出
            command.stdout(Stdio::null());
            command.stderr(Stdio::null());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let model = dir.join("resources").join("models").join("best.onnx");
            if model.is_file() {
                command.env("SCREENPARSER_ONNX_MODEL", model);
            }
        }
    }

    let mut child = command.spawn().ok()?;
    let url = format!("http://127.0.0.1:{port}");

    // 健康检查：轮询 /health（用 std::net 直连，避免引入 HTTP 依赖），
    // 超时则杀进程并放弃（不阻断应用启动）
    use std::io::{Read, Write};
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(HEALTH_POLL_INTERVAL);
        // 子进程已退出则直接放弃
        if let Ok(Some(_)) = child.try_wait() {
            return None;
        }
        if let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.write_all(
                format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            );
            let mut buf = String::new();
            if stream.read_to_string(&mut buf).is_ok() && buf.contains("200") {
                return Some((child, url));
            }
        }
    }
    let _ = child.kill();
    None
}

/// 前端唯一可调用命令：返回推理服务地址（None = 不可用，前端降级）
#[tauri::command]
fn detect_server_url(state: State<DetectServer>) -> Option<String> {
    state.url.lock().unwrap().clone()
}

pub fn run() {
    tauri::Builder::default()
        .manage(DetectServer {
            child: Mutex::new(None),
            url: Mutex::new(None),
        })
        .setup(|app| {
            let state: State<DetectServer> = app.state();
            match start_detect_server() {
                Some((child, url)) => {
                    *state.child.lock().unwrap() = Some(child);
                    *state.url.lock().unwrap() = Some(url.clone());
                    println!("[style-skill] detect server ready: {url}");
                }
                None => {
                    println!("[style-skill] detect server unavailable, running in degraded mode");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<DetectServer>() {
                    if let Some(mut child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![detect_server_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
