#!/usr/bin/env python3
"""Generate an ordinary Xcode project with no additional project-generator dependency."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def project_spec(ios_root):
    objects = {}
    def add(object_key, isa, **fields):
        key = identifier(object_key)
        objects[key] = {"isa": isa, **fields}
        return key
    sources = []
    files = []
    for path in sorted((ios_root / "AestheticBridge").glob("*.swift")):
        ref = add(path.name, "PBXFileReference", lastKnownFileType="sourcecode.swift", path=path.name, sourceTree="<group>")
        files.append(ref)
        sources.append(add("build-"+path.name, "PBXBuildFile", fileRef=ref))
    entitlement = add("entitlements", "PBXFileReference", lastKnownFileType="text.plist.entitlements", path="AestheticBridge.entitlements", sourceTree="<group>")
    source_group = add("source-group", "PBXGroup", path="AestheticBridge", children=[*files, entitlement], sourceTree="<group>")
    product = add("app", "PBXFileReference", explicitFileType="wrapper.application", path="AestheticBridge.app", sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)
    products = add("products", "PBXGroup", name="Products", children=[product], sourceTree="<group>")
    framework = add("healthkit", "PBXFileReference", lastKnownFileType="wrapper.framework", name="HealthKit.framework", path="System/Library/Frameworks/HealthKit.framework", sourceTree="SDKROOT")
    framework_build = add("build-healthkit", "PBXBuildFile", fileRef=framework)
    frameworks_group = add("frameworks-group", "PBXGroup", name="Frameworks", children=[framework], sourceTree="<group>")
    main_group = add("main-group", "PBXGroup", children=[source_group, products, frameworks_group], sourceTree="<group>")
    sources_phase = add("sources-phase", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=sources, runOnlyForDeploymentPostprocessing=0)
    frameworks_phase = add("frameworks-phase", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[framework_build], runOnlyForDeploymentPostprocessing=0)
    resources_phase = add("resources-phase", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
    project_configs, target_configs = [], []
    for configuration in ("Debug", "Release"):
        debug = configuration == "Debug"
        project_configs.append(add("project-"+configuration, "XCBuildConfiguration", name=configuration, buildSettings={
            "SDKROOT":"iphoneos", "IPHONEOS_DEPLOYMENT_TARGET":"17.0", "CLANG_ENABLE_MODULES":"YES",
            "SWIFT_VERSION":"5.0", "SWIFT_OPTIMIZATION_LEVEL":"-Onone" if debug else "-O",
            "DEBUG_INFORMATION_FORMAT":"dwarf" if debug else "dwarf-with-dsym",
            "SWIFT_ACTIVE_COMPILATION_CONDITIONS":"DEBUG" if debug else "",
        }))
        target_configs.append(add("target-"+configuration, "XCBuildConfiguration", name=configuration, buildSettings={
            "PRODUCT_NAME":"$(TARGET_NAME)", "PRODUCT_BUNDLE_IDENTIFIER":"local.aestheticlab.bridge",
            "MARKETING_VERSION":"0.1.0", "CURRENT_PROJECT_VERSION":"1", "TARGETED_DEVICE_FAMILY":"1",
            "CODE_SIGN_STYLE":"Automatic", "CODE_SIGN_ENTITLEMENTS":"AestheticBridge/AestheticBridge.entitlements",
            "GENERATE_INFOPLIST_FILE":"YES", "INFOPLIST_KEY_CFBundleDisplayName":"Aesthetic Bridge",
            "INFOPLIST_KEY_NSHealthShareUsageDescription":"Read the Liftoff workout summaries you select for your private Mac dashboard.",
            "INFOPLIST_KEY_NSHealthUpdateUsageDescription":"Aesthetic Bridge does not write health data.",
            "INFOPLIST_KEY_UILaunchScreen_Generation":"YES", "INFOPLIST_KEY_UIApplicationSceneManifest_Generation":"YES",
            "SUPPORTED_PLATFORMS":"iphoneos iphonesimulator", "SUPPORTS_MACCATALYST":"NO",
            "LD_RUNPATH_SEARCH_PATHS":["$(inherited)","@executable_path/Frameworks"],
        }))
    project_config_list = add("project-config-list", "XCConfigurationList", buildConfigurations=project_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    target_config_list = add("target-config-list", "XCConfigurationList", buildConfigurations=target_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    target = add("target", "PBXNativeTarget", name="AestheticBridge", productName="AestheticBridge", productType="com.apple.product-type.application",
                 productReference=product, buildConfigurationList=target_config_list, buildPhases=[sources_phase,frameworks_phase,resources_phase], buildRules=[], dependencies=[])
    project = add("project", "PBXProject", attributes={"LastUpgradeCheck":"1600", "TargetAttributes":{target:{"CreatedOnToolsVersion":"16.0", "SystemCapabilities":{"com.apple.HealthKit":{"enabled":1}}}}},
                  buildConfigurationList=project_config_list, compatibilityVersion="Xcode 14.0", developmentRegion="en", knownRegions=["en","Base"],
                  mainGroup=main_group, productRefGroup=products, projectDirPath="", projectRoot="", targets=[target])
    return {"archiveVersion":1, "classes":{}, "objectVersion":56, "objects":objects, "rootObject":project}, target


def openstep(value, depth=0):
    indent = "\t" * depth
    if isinstance(value, dict):
        return "{\n" + "".join(f"{indent}\t{json.dumps(k)} = {openstep(v,depth+1)};\n" for k,v in value.items()) + indent + "}"
    if isinstance(value, list):
        return "(\n" + "".join(f"{indent}\t{openstep(v,depth+1)},\n" for v in value) + indent + ")"
    return json.dumps(value, ensure_ascii=True)


def prepare(ios_root=ROOT / "ios"):
    project_path = ios_root / "AestheticBridge.xcodeproj"
    project_path.mkdir(exist_ok=True)
    spec, target = project_spec(ios_root)
    (project_path / "project.pbxproj").write_text("// !$*UTF8*$!\n" + openstep(spec) + "\n",encoding='utf-8')
    scheme_folder = project_path / "xcshareddata/xcschemes"
    scheme_folder.mkdir(parents=True,exist_ok=True)
    reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="AestheticBridge.app" BlueprintName="AestheticBridge" ReferencedContainer="container:AestheticBridge.xcodeproj"/>'
    (scheme_folder / "AestheticBridge.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
    return project_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--open",action="store_true")
    args = parser.parse_args()
    path = prepare()
    print(f"Prepared Xcode project: {path}")
    print("In Xcode select your signing team, choose a unique bundle ID, connect your iPhone, then Run.")
    if args.open:
        xcode = Path("/Applications/Xcode.app")
        if not xcode.exists():
            print("Full Xcode is not installed. Get a version compatible with this Mac from https://developer.apple.com/download/all/?q=Xcode")
            print("Project generation is complete; compilation and iPhone installation have not run.")
            raise SystemExit(2)
        subprocess.run(["/usr/bin/open","-a",str(xcode),str(path)],check=True)
