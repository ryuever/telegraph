import { Registry } from '@x-oasis/di'
import ChatApplication, { ChatApplicationId } from './chat-application'

export default new Registry((bind) => {
  bind(ChatApplicationId).to(ChatApplication).inSingletonScope()
})
