import { MediaLibrary } from "./MediaLibrary.js";
import { Preview } from "./Preview.js";
import { Timeline } from "./Timeline.js";
import { Inspector } from "./Inspector.js";

export function Workspace() {
  return (
    <div className="workspace">
      <div className="panel left">
        <MediaLibrary />
      </div>
      <div className="panel center">
        <Preview />
      </div>
      <div className="panel right">
        <Inspector />
      </div>
      <div className="panel timeline-area">
        <Timeline />
      </div>
    </div>
  );
}
