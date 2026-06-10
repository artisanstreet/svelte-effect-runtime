use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

use zed_extension_api::{self as zed, serde_json, Result};

struct SvelteEffectRuntimeExtension {
    installed: HashSet<String>,
}

const LANGUAGE_SERVER_BINARY_NAME: &str = "svelte-effect-runtime-language-server";
const LANGUAGE_SERVER_PACKAGE_NAME: &str = "svelte-effect-runtime-language-server";
const RELEASE_REPOSITORY: &str = "usebarekey/svelte-effect-runtime";
const MANAGED_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const TS_PLUGIN_PACKAGE_NAME: &str = "typescript-svelte-plugin";
const LANGUAGE_SERVER_RUNTIME_DEPENDENCIES: &[(&str, &str)] = &[
    ("@jridgewell/trace-mapping", "0.3.31"),
    ("svelte-language-server", "0.17.30"),
    ("vscode-languageserver", "9.0.1"),
    ("magic-string", "0.30.21"),
    ("typescript", "5.9.3"),
    ("svelte", "5.56.0"),
];

fn package_path(package_name: &str) -> Result<PathBuf> {
    let path = env::current_dir()
        .map_err(|error| error.to_string())?
        .join("node_modules")
        .join(package_name);

    Ok(path)
}

fn extension_path(relative_path: &str) -> Result<PathBuf> {
    let path = env::current_dir()
        .map_err(|error| error.to_string())?
        .join(relative_path);

    Ok(path)
}

fn is_file(path: &PathBuf) -> bool {
    fs::metadata(path).map_or(false, |metadata| metadata.is_file())
}

fn extension_version() -> Result<String> {
    let manifest_path = extension_path("extension.toml")?;
    let manifest = fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?;

    let version = manifest.lines().find_map(|line| {
        let value = line.trim().strip_prefix("version = ")?;

        Some(value.trim_matches('"').to_string())
    });

    match version {
        Some(version) if !version.is_empty() => Ok(version),
        _ => Err(format!(
            "failed to read version from {}",
            manifest_path.to_string_lossy(),
        )),
    }
}

fn release_server_dir(version: &str) -> String {
    format!("{}-{}", LANGUAGE_SERVER_PACKAGE_NAME, version)
}

fn release_server_script_relative_path(version: &str) -> String {
    format!("{}/package/.dist/server.cjs", release_server_dir(version))
}

fn release_server_runtime_relative_path(version: &str) -> String {
    format!(
        "{}/package/runtime/package.json",
        release_server_dir(version)
    )
}

impl SvelteEffectRuntimeExtension {
    fn install_package_if_needed(
        &mut self,
        id: &zed::LanguageServerId,
        package_name: &str,
    ) -> Result<()> {
        let installed_version = zed::npm_package_installed_version(package_name)?;

        if installed_version.is_some() && self.installed.contains(package_name) {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let latest_version = zed::npm_package_latest_version(package_name)?;

        if installed_version.as_ref() != Some(&latest_version) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );

            let install_result = zed::npm_install_package(package_name, &latest_version);

            if let Err(error) = install_result {
                if installed_version.is_none() {
                    Err(error)?;
                }
            }
        }

        self.installed.insert(package_name.into());

        Ok(())
    }

    fn install_package_version_if_needed(
        &mut self,
        id: &zed::LanguageServerId,
        package_name: &str,
        version: &str,
    ) -> Result<()> {
        let install_key = format!("{}@{}", package_name, version);
        let installed_version = zed::npm_package_installed_version(package_name)?;

        if installed_version.as_deref() == Some(version) {
            self.installed.insert(install_key);

            return Ok(());
        }

        if self.installed.contains(&install_key) {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        zed::npm_install_package(package_name, version)?;
        self.installed.insert(install_key);

        Ok(())
    }

    fn install_language_server_runtime_dependencies(
        &mut self,
        id: &zed::LanguageServerId,
    ) -> Result<()> {
        for (package_name, version) in LANGUAGE_SERVER_RUNTIME_DEPENDENCIES {
            self.install_package_version_if_needed(id, package_name, version)?;
        }

        Ok(())
    }

    fn configured_server_command(
        &self,
        id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::Command>> {
        let settings = zed::settings::LspSettings::for_worktree(id.as_ref(), worktree)?;
        let Some(binary) = settings.binary else {
            return Ok(None);
        };

        let Some(command) = binary.path else {
            return Ok(None);
        };

        let args = binary
            .arguments
            .unwrap_or_else(|| vec!["--stdio".to_string()]);

        let mut env: zed::EnvVars = binary.env.unwrap_or_default().into_iter().collect();
        env.sort_by(|(left, _), (right, _)| left.cmp(right));

        Ok(Some(zed::Command { command, args, env }))
    }

    fn local_server_command(&self, worktree: &zed::Worktree) -> Option<zed::Command> {
        let command = worktree.which(LANGUAGE_SERVER_BINARY_NAME)?;

        Some(zed::Command {
            command,
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn installed_server_script_path(&self) -> Result<Option<String>> {
        let path = extension_path(MANAGED_LANGUAGE_SERVER_SCRIPT_PATH)?;

        if is_file(&path) {
            return Ok(Some(path.to_string_lossy().to_string()));
        }

        Ok(None)
    }

    fn release_server_script_path(&mut self, id: &zed::LanguageServerId) -> Result<String> {
        let version = extension_version()?;
        let script_relative_path = release_server_script_relative_path(&version);
        let runtime_relative_path = release_server_runtime_relative_path(&version);
        let script_path = extension_path(&script_relative_path)?;
        let runtime_path = extension_path(&runtime_relative_path)?;

        if is_file(&script_path) && is_file(&runtime_path) {
            return Ok(script_path.to_string_lossy().to_string());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let release =
            zed::github_release_by_tag_name(RELEASE_REPOSITORY, &format!("v{}", version))?;
        let asset_name = format!("{}-{}.tgz", LANGUAGE_SERVER_PACKAGE_NAME, version);
        let download_url = release
            .assets
            .iter()
            .find(|asset| asset.name == asset_name)
            .map(|asset| asset.download_url.clone())
            .ok_or_else(|| {
                format!(
                    "release v{} did not contain expected asset '{}'",
                    version, asset_name,
                )
            })?;

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        let server_dir = release_server_dir(&version);
        let server_dir_path = extension_path(&server_dir)?;

        if server_dir_path.exists() {
            fs::remove_dir_all(&server_dir_path).map_err(|error| error.to_string())?;
        }

        zed::download_file(&download_url, &server_dir, zed::DownloadedFileType::GzipTar)?;

        if !is_file(&script_path) {
            Err(format!(
                "downloaded asset '{}' did not contain expected path '{}'",
                asset_name, script_relative_path,
            ))?;
        }

        if !is_file(&runtime_path) {
            Err(format!(
                "downloaded asset '{}' did not contain expected path '{}'",
                asset_name, runtime_relative_path,
            ))?;
        }

        Ok(script_path.to_string_lossy().to_string())
    }

    fn managed_server_script_path(&mut self, id: &zed::LanguageServerId) -> Result<String> {
        if let Some(path) = self.installed_server_script_path()? {
            return Ok(path);
        }

        self.install_language_server_runtime_dependencies(id)?;
        self.release_server_script_path(id)
    }
}

impl zed::Extension for SvelteEffectRuntimeExtension {
    fn new() -> Self {
        Self {
            installed: HashSet::new(),
        }
    }

    fn language_server_command(
        &mut self,
        id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        self.install_package_if_needed(id, TS_PLUGIN_PACKAGE_NAME)?;

        if let Some(command) = self.configured_server_command(id, worktree)? {
            return Ok(command);
        }

        if let Some(command) = self.local_server_command(worktree) {
            return Ok(command);
        }

        let script_path = self.managed_server_script_path(id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _: &zed::LanguageServerId,
        _: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        let config = serde_json::json!({
            "inlayHints": {
                "parameterNames": {
                    "enabled": "all",
                    "suppressWhenArgumentMatchesName": false
                },
                "parameterTypes": {
                    "enabled": true
                },
                "variableTypes": {
                    "enabled": true,
                    "suppressWhenTypeMatchesName": false
                },
                "propertyDeclarationTypes": {
                    "enabled": true
                },
                "functionLikeReturnTypes": {
                    "enabled": true
                },
                "enumMemberValues": {
                    "enabled": true
                }
            }
        });

        Ok(Some(serde_json::json!({
            "provideFormatter": true,
            "dontFilterIncompleteCompletions": true,
            "configuration": {
                "typescript": config,
                "javascript": config
            }
        })))
    }

    fn language_server_additional_workspace_configuration(
        &mut self,
        _: &zed::LanguageServerId,
        target_id: &zed::LanguageServerId,
        _: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        let plugin_location = package_path(TS_PLUGIN_PACKAGE_NAME)?
            .to_string_lossy()
            .to_string();

        match target_id.as_ref() {
            "vtsls" => Ok(Some(serde_json::json!({
                "vtsls": {
                    "tsserver": {
                        "globalPlugins": [{
                            "name": TS_PLUGIN_PACKAGE_NAME,
                            "location": plugin_location,
                            "enableForWorkspaceTypeScriptVersions": true
                        }]
                    }
                },
            }))),
            _ => Ok(None),
        }
    }
}

zed::register_extension!(SvelteEffectRuntimeExtension);
