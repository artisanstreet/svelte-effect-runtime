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
const LOCAL_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "../svelte-effect-runtime-language-server/.dist/server.cjs";
const MANAGED_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const INSTALLED_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "../../work/svelte-effect-runtime/node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const WORKTREE_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const TS_PLUGIN_PACKAGE_NAME: &str = "typescript-svelte-plugin";

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

    fn local_server_command(&self, worktree: &zed::Worktree) -> Option<zed::Command> {
        let command = worktree.which(LANGUAGE_SERVER_BINARY_NAME)?;

        Some(zed::Command {
            command,
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn worktree_server_script_path(&self, worktree: &zed::Worktree) -> Option<String> {
        let path = PathBuf::from(worktree.root_path())
            .join(WORKTREE_LANGUAGE_SERVER_SCRIPT_PATH);

        Some(path.to_string_lossy().to_string())
    }

    fn repository_server_script_path(&self) -> Result<Option<String>> {
        let path = extension_path(LOCAL_LANGUAGE_SERVER_SCRIPT_PATH)?;

        if !is_file(&path) {
            return Ok(None);
        }

        Ok(Some(path.to_string_lossy().to_string()))
    }

    fn managed_server_script_path(&mut self, id: &zed::LanguageServerId) -> Result<String> {
        for relative_path in [
            MANAGED_LANGUAGE_SERVER_SCRIPT_PATH,
            INSTALLED_LANGUAGE_SERVER_SCRIPT_PATH,
        ] {
            let path = extension_path(relative_path)?;

            if is_file(&path) {
                return Ok(path.to_string_lossy().to_string());
            }
        }

        self.install_package_if_needed(id, LANGUAGE_SERVER_PACKAGE_NAME)?;

        let path = extension_path(MANAGED_LANGUAGE_SERVER_SCRIPT_PATH)?;

        if !is_file(&path) {
            Err(format!(
                "installed package '{}' did not contain expected path '{}'",
                LANGUAGE_SERVER_PACKAGE_NAME,
                MANAGED_LANGUAGE_SERVER_SCRIPT_PATH,
            ))?;
        }

        Ok(path.to_string_lossy().to_string())
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

        if let Some(command) = self.local_server_command(worktree) {
            return Ok(command);
        }

        if let Some(script_path) = self.worktree_server_script_path(worktree) {
            return Ok(zed::Command {
                command: zed::node_binary_path()?,
                args: vec![script_path, "--stdio".to_string()],
                env: Default::default(),
            });
        }

        let script_path = match self.repository_server_script_path()? {
            Some(path) => path,
            None => self.managed_server_script_path(id)?,
        };

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
