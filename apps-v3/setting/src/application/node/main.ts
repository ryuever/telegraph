import { Container, Registry } from '@x-oasis/di';
import { SettingWorker, SettingWorkerId } from './SettingWorker';
import { PageletWorkerConfigId } from '@telegraph/pagelet-host/node/PageletWorker';
import { SETTING_PARTICIPANT_ID } from '@telegraph/setting/application/common';
import { RENDERER_PARTICIPANT_ID } from '@telegraph/pagelet-host/common';

const SELF_ID = SETTING_PARTICIPANT_ID;

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: SELF_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    });
    bind(SettingWorkerId).to(SettingWorker);
  })
);

const worker = container.get(SettingWorkerId) as SettingWorker;
worker
  .boot()
  .catch((err) => console.error(`[${SELF_ID}-worker] boot failed:`, err));
