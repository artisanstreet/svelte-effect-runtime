use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

use zed_extension_api::{self as zed, serde_json, Result};

struct SvelteEffectRuntimeExtension {
    installed: HashSet<String>,
}

const LANGUAGE_SERVER_PACKAGE_NAME: &str = "svelte-effect-runtime-language-server";
const LOCAL_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "../svelte-effect-runtime-language-server/.dist/server.cjs";
const LOCAL_LANGUAGE_SERVER_RUNTIME_PATH: &str =
    "../svelte-effect-runtime-language-server/runtime/package.json";
const MANAGED_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const MANAGED_LANGUAGE_SERVER_RUNTIME_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/runtime/package.json";
const INSTALLED_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "../../work/svelte-effect-runtime-language-server/node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const INSTALLED_LANGUAGE_SERVER_RUNTIME_PATH: &str =
    "../../work/svelte-effect-runtime-language-server/node_modules/svelte-effect-runtime-language-server/runtime/package.json";
const WORKTREE_LANGUAGE_SERVER_SCRIPT_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/.dist/server.cjs";
const WORKTREE_LANGUAGE_SERVER_RUNTIME_PATH: &str =
    "node_modules/svelte-effect-runtime-language-server/runtime/package.json";
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

fn verified_script_path(script_path: PathBuf, runtime_path: PathBuf) -> Option<String> {
    if !is_file(&script_path) || !is_file(&runtime_path) {
        return None;
    }

    Some(script_path.to_string_lossy().to_string())
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

    fn worktree_server_script_path(&self, worktree: &zed::Worktree) -> Option<String> {
        let script_path =
            PathBuf::from(worktree.root_path()).join(WORKTREE_LANGUAGE_SERVER_SCRIPT_PATH);
        let runtime_path =
            PathBuf::from(worktree.root_path()).join(WORKTREE_LANGUAGE_SERVER_RUNTIME_PATH);

        verified_script_path(script_path, runtime_path)
    }

    fn repository_server_script_path(&self) -> Result<Option<String>> {
        let script_path = extension_path(LOCAL_LANGUAGE_SERVER_SCRIPT_PATH)?;
        let runtime_path = extension_path(LOCAL_LANGUAGE_SERVER_RUNTIME_PATH)?;

        Ok(verified_script_path(script_path, runtime_path))
    }

    fn installed_server_script_path(&self) -> Result<Option<String>> {
        for (script_relative_path, runtime_relative_path) in [
            (
                MANAGED_LANGUAGE_SERVER_SCRIPT_PATH,
                MANAGED_LANGUAGE_SERVER_RUNTIME_PATH,
            ),
            (
                INSTALLED_LANGUAGE_SERVER_SCRIPT_PATH,
                INSTALLED_LANGUAGE_SERVER_RUNTIME_PATH,
            ),
        ] {
            let script_path = extension_path(script_relative_path)?;
            let runtime_path = extension_path(runtime_relative_path)?;

            if let Some(path) = verified_script_path(script_path, runtime_path) {
                return Ok(Some(path));
            }
        }

        Ok(None)
    }

    fn npm_server_script_path(&mut self, id: &zed::LanguageServerId) -> Result<String> {
        self.install_package_if_needed(id, LANGUAGE_SERVER_PACKAGE_NAME)?;

        self.installed_server_script_path()?.ok_or_else(|| {
            format!(
                "npm package '{}' did not contain .dist/server.cjs and runtime/package.json",
                LANGUAGE_SERVER_PACKAGE_NAME,
            )
        })
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

        if let Some(script_path) = self.worktree_server_script_path(worktree) {
            return Ok(zed::Command {
                command: zed::node_binary_path()?,
                args: vec![script_path, "--stdio".to_string()],
                env: Default::default(),
            });
        }

        let script_path = match self.repository_server_script_path()? {
            Some(path) => path,
            None => match self.installed_server_script_path()? {
                Some(path) => path,
                None => self.npm_server_script_path(id)?,
            },
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
