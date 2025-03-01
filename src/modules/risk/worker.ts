import * as vscode from 'vscode';
import { Settings } from '../../settings';
import * as fs from "fs";
import * as path from 'path';
import { Context } from 'vm';
const axios = require('axios');
import { Md5 } from 'ts-md5/dist/md5';
const extension = require('../../extension');

let busyIndicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);

var rootDirectory: File;
var pendingFiles: File[] = [];

interface Item {
	path: string;
	name: string;
	relativePath: string;
	lines: number;
	content: string;
	match: number[];
	extension: string;
	lastModified: Date;
	hash: string;
}

interface File {
	path: string;
	name: string;
	extension: string;
	relativePath: string;
	hash: string;
	parent: File;
	lastModified: Date;
	isDirectory: boolean;
	content: string;
	lines: number;
	children: FileMap;
}

interface FileMap {
	[key: string]: File;
}

export function init() {
	if (Settings.isRiskEnabled()) {
		initFileWatcher();
	}
}

function initFileWatcher() {
	busyIndicator.text = "Scanning working directory...";
	busyIndicator.show();
	if (extension.currentWorkspaceFolder) {
		initRootDirectory();
	
		busyIndicator.text = "Upload files to webserver...";
		uploadToServer();
	} else {
		busyIndicator.text = "No workspace selected";
	}
}

function initRootDirectory() {
	rootDirectory = {} as File;
	rootDirectory.path = (extension.currentWorkspaceFolder as vscode.WorkspaceFolder).uri.fsPath;
	rootDirectory.name = path.basename(rootDirectory.path);
	rootDirectory.relativePath = rootDirectory.name;
	rootDirectory.isDirectory = true;
	rootDirectory.hash = Md5.hashStr(rootDirectory.path) as string;
	rootDirectory.children = {} as FileMap;
	scanDirectory(rootDirectory);
}

function addFile(parent: File, absolutePath: string): File | null {
	let fileName = path.basename(absolutePath);
	let relativePath = path.join(parent.relativePath, fileName);
	let extension = path.extname(absolutePath);
	if (Settings.excludeFileType.indexOf(extension) > -1) {
		return null;
	}
	let newFile = {} as File;
	newFile.path = absolutePath;
	newFile.isDirectory = false;
	newFile.relativePath = relativePath;
	newFile.name = fileName;
	newFile.parent = parent;
	newFile.hash = Md5.hashStr(absolutePath) as string;
	newFile.extension = extension;
	newFile.lastModified = fs.statSync(absolutePath).mtime;

	let content = fs.readFileSync(absolutePath).toString();
	let lineCount = content.split(/\r\n|\r|\n/).length;
	newFile.content = content;
	newFile.lines = lineCount;
	parent.children[newFile.name] = newFile;

	return newFile;
}

function scanDirectory(directory: File) {
	try {
		var files = fs.readdirSync(directory.path);

		files.forEach(function (file: any) {
			let relativePath = path.join(directory.relativePath, file);
			let absolutePath = path.join(directory.path, file);

			if (fs.statSync(absolutePath).isDirectory()) {
				if (Settings.excludeFolderName.indexOf(directory.name) > -1) {
					return;
				}
				let newDirectory = {} as File;
				newDirectory.isDirectory = true;
				newDirectory.path = absolutePath;
				newDirectory.relativePath = relativePath;
				newDirectory.name = file;
				newDirectory.parent = directory;
				newDirectory.hash = Md5.hashStr(absolutePath) as string;
				newDirectory.children = {} as FileMap;
				newDirectory.lastModified = fs.statSync(absolutePath).mtime;
				directory.children[newDirectory.name] = newDirectory;
				scanDirectory(newDirectory);
			} else {
				let newFile = addFile(directory, absolutePath);
				if (newFile !== null) {
					pendingFiles.push(newFile);
				}
			}
		});
	} catch (e) {
		console.log(e);
	}
}

function uploadToServer() {
	if (pendingFiles.length === 0) {
		busyIndicator.text = "Upload done.";
		return;
	}
	busyIndicator.text = `Uploading files: ${pendingFiles.length} files remaining`;
	let item: File = pendingFiles.pop() as File;

	let url = Settings.getLanguagemodelHostname();

	let content = item.content;

	// Risk -> languagemodel
	if (Settings.supportedFileTypes.indexOf(item.extension) > -1) {

		let timestamp = fs.statSync(item.path).mtimeMs;

		axios.post(url, { 
			content: content,
			languageId: item.extension.replace(/\./, ''),
			filePath: item.path,
			timestamp: timestamp,
			noReturn: true,
			workspaceFolder: extension.currentWorkspaceFolder
		 })
			.then((response: any) => {
				//	console.log("request handled for: " + item.path);
				//	console.log(response.data);
			})
			.catch((error: any) => {
				if (error.response.status === 406) {
					//	console.log("file not supported " + item.path);
				} else {
					//	console.log("Error in worker.ts");
					console.log(error);
				}
			})
			.finally(function () {
				uploadToServer();
			});
	} else {
		uploadToServer();
	}

}