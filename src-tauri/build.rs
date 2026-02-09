use std::fs;
use std::path::Path;

fn main() {
    // Read version from Cargo.toml and generate a version file
    // This ensures main.rs always gets the current version
    let cargo_toml = fs::read_to_string("Cargo.toml").unwrap();
    let version = cargo_toml
        .lines()
        .find(|line| line.starts_with("version"))
        .and_then(|line| line.split('"').nth(1))
        .unwrap_or("0.0.0");

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("version.rs");
    fs::write(&dest_path, format!("pub const VERSION: &str = \"{}\";", version)).unwrap();

    // Rerun if Cargo.toml changes
    println!("cargo:rerun-if-changed=Cargo.toml");

    // Only embed requireAdministrator manifest for release builds
    let is_release = std::env::var("PROFILE").unwrap_or_default() == "release";

    let attrs = if is_release {
        let windows_attrs = tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("app.manifest"));
        tauri_build::Attributes::new().windows_attributes(windows_attrs)
    } else {
        tauri_build::Attributes::new()
    };

    tauri_build::try_build(attrs).expect("failed to run tauri build");
}
