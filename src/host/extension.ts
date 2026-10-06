import * as vscode from 'vscode'
import {Actions, registerCommands} from './actions'
import {RoomController} from './controller'
import {SidebarProvider} from './ui/sidebar-provider'
import {createStatusBar} from './ui/status-bar'

let controller: RoomController | undefined

export function activate(context: vscode.ExtensionContext): void {
  controller = new RoomController(context)
  const actions = new Actions(controller)
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      new SidebarProvider(context.extensionUri, controller, actions),
      // La vista conserva su estado al ocultarse; el audio no depende de ella.
      {webviewOptions: {retainContextWhenHidden: true}}
    ),
    createStatusBar(controller),
    ...registerCommands(actions)
  )
}

/** VS Code espera a esta promesa al cerrar: da tiempo a despedirse y a matar el navegador. */
export function deactivate(): Promise<void> | undefined {
  return controller?.leave()
}
