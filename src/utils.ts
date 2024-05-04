import fs from 'fs';
import path from 'path';

/**
 * Lists all files in the given directory
 * @param dir The directory to list files from
 * @param includeExactPath Whether to include the exact path of the file or not
 * @param fileList The list of files to append to
 * @returns The list of files
 */
export function listFiles(dir: string, includeExactPath = false, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        let filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            listFiles(filePath, includeExactPath, fileList);
        } else {
            filePath = filePath
                .replaceAll('\\', '/');
            if (!includeExactPath) {
                filePath = filePath
                    .replace(`${import.meta.dir}/`, '');
            }
            fileList.push(filePath);
        }
    });

    return fileList;
}
