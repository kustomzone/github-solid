// Gitter chat data to solid
// like GITTER_TOKEN 1223487...984 node solid-gitter.js
// See https://developer.gitter.im/docs/welcome
// and https://developer.gitter.im/docs/rest-api

require('dotenv').config()

const command = process.argv[2]
const targetRoomName = process.argv[3] // solid/chat
const archiveBaseURI = process.argv[4] // like 'https://timbl.com/timbl/Public/Archive/'
/*
if (command !== 'list' && !archiveBaseURI) {
  console.error('syntax:  node solid=gitter.js  <command> <chatroom>  <solid archive root>')
  process.exit(1)
}
*/
const { Octokit } = require('@octokit/rest')

const octokit = new Octokit({
  userAgent: 'github-solid',

  timeZone: 'Europe/Amsterdam',

   logs: { debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error}

})

// var Gitter = require('node-gitter')
var $rdf = require('rdflib')
const solidNamespace = require('solid-namespace')
const ns = solidNamespace($rdf)

if (!ns.wf) {
  ns.wf = new $rdf.Namespace('http://www.w3.org/2005/01/wf/flow#') //  @@ sheck why necessary
}
// see https://www.npmjs.com/package/node-gitter

// console.log('GITTER_TOKEN ' + GITTER_TOKEN)
// const gitter = new Gitter(GITTER_TOKEN)


// import readline from 'readline-promise';

// const readLinePromise = require('readline-promise')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
})

function question (q) {
  return new Promise((resolve, reject) => {
    rl.question(q + ' ', (a) => { // space for answer not to be crowded
      rl.close()
      resolve(a)
    })
  })
}

async function confirm (q) {
  while (1) {
    var a = await question(q)
    if (a === 'yes' || a === 'y') return true
    if (a === 'no' || a === 'n') return false
    console.log('  Please reply y or n')
  }
}
/* Solid Authentication
*/
/*
const SOLID_TOKEN = process.env.SOLID_TOKEN
console.log('SOLID_TOKEN ' + SOLID_TOKEN.length)
if (!SOLID_TOKEN) {
  console.log('NO SOLID TOKEN')
  process.exit(2)
}
*/

const normalOptions = {
//   headers: {Authorization: 'Bearer ' + SOLID_TOKEN}
}
const forcingOptions = {
  // headers: {Authorization: 'Bearer ' + SOLID_TOKEN},
  force: true }

function clone (options) {
  return Object.assign({}, options)
}

/// ///////////////////////////// Solid Bits

const store = $rdf.graph()
const kb = store // shorthand -- knowledge base

const auth = require('solid-auth-cli') // https://www.npmjs.com/package/solid-auth-cli

const fetcher = $rdf.fetcher(store, {fetch: auth.fetch, timeout: 900000})

// const fetcher = new $rdf.Fetcher(store, {timeout: 900000}) // ms
const updater = new $rdf.UpdateManager(store)
// const updater = new $rdf.UpdateManager(store)

function delayMs (ms) {
  console.log('pause ... ')
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chatDocumentFromDate (chatChannel, date) {
  let isoDate = date.toISOString() // Like "2018-05-07T17:42:46.576Z"
  var path = isoDate.split('T')[0].replace(/-/g, '/') //  Like "2018/05/07"
  path = chatChannel.dir().uri + path + '/chat.ttl'
  return $rdf.sym(path)
}

/* Test version of update
*/

/*
async function update (ddd, sts) {
  const doc = sts[0].why
  // console.log('   Delete ' + ddd.length )
  console.log('   Insert ' + sts.length + ' in ' + doc)
  for (let i = 0; i < sts.length; i++) {
    let st = sts[i]
    console.log(`       ${i}: ${st.subject} ${st.predicate} ${st.object} .`)
  }
}
*/
// individualChatBaseURI', 'privateChatBaseURI', 'publicChatBaseURI
function archiveBaseURIFromGitterRoom (room, config) {
  return room.oneToOne ? config.individualChatBaseURI
         : room.public ? config.publicChatBaseURI : config.privateChatBaseURI
}

/** Decide URI of solid chat vchanel from properties of gitter room
 *
 * @param room {Room} - like 'solid/chat'
*/
function chatChannelFromGitterRoom (room, config) {
  var path
  let segment = room.name.split('/').map(encodeURIComponent).join('/') // Preseeve the slash begween org and room
  if (room.githubType === 'ORG') {
    segment += '/_Organization' // make all multi rooms two level names
  }
  var archiveBaseURI = archiveBaseURIFromGitterRoom(room, config)
  // console.log('archiveBaseURI ' + archiveBaseURI)
  if (!archiveBaseURI.endsWith('/')) throw new Error('base should end with slash')
  if (room.oneToOne) {
    var username = room.user.username
    if (!username) throw new Error('one-one must have user username!')
    console.log(`     ${room.githubType}: ${username}: ${room.name}`)
    path = archiveBaseURI + username
  } else {
    path = archiveBaseURI + segment
  }
  return $rdf.sym(path + '/index.ttl#this')
}

/** Track gitter users

*/

async function putResource (doc) {
  delete fetcher.requested[doc.uri] // invalidate read cache @@ should be done by fetcher in future
  return fetcher.putBack(doc, clone(normalOptions))
}

async function loadIfExists (doc) {
  try {
    // delete fetcher.requested[doc.uri]
    await fetcher.load(doc, clone(normalOptions))
    return true
  } catch (err) {
    if (err.response && err.response.status && err.response.status === 404) {
      // console.log('    No chat file yet, creating later ' + doc)
      return false
    } else {
      console.log(' #### Error reading  file ' + err)
      console.log('            error object  ' + JSON.stringify(err))
      console.log('        err.response   ' + err.response)
      console.log('        err.response.status   ' + err.response.status)
      process.exit(4)
    }
  }
}

function suitable (x) {
  let tail = x.uri.slice(0, -1).split('/').slice(-1)[0]
  if (!'0123456789'.includes(tail[0])) return false // not numeric
  return true
  // return kb.anyValue(chatDocument, POSIX('size')) !== 0 // empty file?
}

async function firstMessage (chatChannel, backwards) { // backwards -> last message
  var folderStore = $rdf.graph()
  var folderFetcher = new $rdf.Fetcher(folderStore)
  async function earliestSubfolder (parent) {
    // console.log('            parent ' + parent)
    delete folderFetcher.requested[parent.uri]
    var resp = await folderFetcher.load(parent, clone(forcingOptions)) // Force fetch as will have changed

    var kids = folderStore.each(parent, ns.ldp('contains'))
    kids = kids.filter(suitable)
    if (kids.length === 0) {
      console.log('            parent2 ' + parent)

      console.log('resp.status ' + resp.status)
      console.log('resp.statusText ' + resp.statusText)

      console.log('folderStore: <<<<<\n' + folderStore + '\n >>>>>>>> ')
      console.trace('ooops no suitable kids - full list:' + folderStore.each(parent, ns.ldp('contains')))
      console.log(' parent: ' + parent)
      console.log(' \ndoc contents: ' + folderStore.statementsMatching(null, null, null, parent))
      console.log(' connected statements: ' + folderStore.connectedStatements(parent))
      // console.log(' connected statements: ' + folderStore.connectedStatements(parent)).map(st => st.toNT()).join('\n   ')
    }

    kids.sort()
    if (backwards) kids.reverse()
    return kids[0]
  }
  let y = await earliestSubfolder(chatChannel.dir())
  let month = await earliestSubfolder(y)
  let d = await earliestSubfolder(month)
  let chatDocument = $rdf.sym(d.uri + 'chat.ttl')
  await folderFetcher.load(chatDocument, clone(normalOptions))
  let messages = folderStore.each(chatChannel, ns.wf('message'), null, chatDocument)
  if (messages.length === 0) {
    let msg = '  INCONSITENCY -- no chat message in file ' + chatDocument
    console.trace(msg)
    throw new Error(msg)
  }
  let sortMe = messages.map(message => [folderStore.any(message, ns.dct('created')), message])
  sortMe.sort()
  if (backwards) sortMe.reverse()
  console.log((backwards ? 'Latest' : 'Earliest') + ' message in solid chat is ' + sortMe[0][1])
  return sortMe[0][1]
}

async function saveEverythingBack () {
  console.log('Saving all modified files:')
  for (let uri in toBePut) {
    if (toBePut.hasOwnProperty(uri)) {
      console.log('Putting ' + uri)
      await putResource($rdf.sym(uri))
      delete fetcher.requested[uri] // invalidate read cache @@ should be done by fether in future
    }
  }
  console.log('Saved all modified files.')
  toBePut = []
}

async function authorFromGitter (fromUser, archiveBaseURI) {
  /* fromUser looks like
    "id": "53307734c3599d1de448e192",
    "username": "malditogeek",
    "displayName": "Mauro Pompilio",
    "url": "/malditogeek",     meaning https://github.com/malditogeek
    "avatarUrlSmall": "https://avatars.githubusercontent.com/u/14751?",
    "avatarUrlMedium": "https://avatars.githubusercontent.com/u/14751?"
  */
  async function saveUserData (fromUser, person) {
    const doc = person.doc()
    store.add(person, ns.rdf('type'), ns.vcard('Individual'), doc)
    store.add(person, ns.rdf('type'), ns.foaf('Person'), doc)
    store.add(person, ns.vcard('fn'), fromUser.displayName, doc)
    store.add(person, ns.foaf('homepage'), 'https://github.com' + fromUser.url, doc)
    store.add(person, ns.foaf('nick'), fromUser.username, doc)
    if (fromUser.avatarUrlMedium) {
      store.add(person, ns.vcard('photo'), $rdf.sym(fromUser.avatarUrlMedium), doc)
    }
    toBePut[doc.uri] = true
  }
  const peopleBaseURI = archiveBaseURI + 'Person/'
  var person = $rdf.sym(peopleBaseURI + encodeURIComponent(fromUser.id) + '/index.ttl#this')
  // console.log('     person id: ' + fromUser.id)
  // console.log('     person solid: ' + person)
  if (peopleDone[person.uri]) {
    console.log('    person already saved ' + fromUser.username)
    return person
  }
  var doc = person.doc()
  if (toBePut[doc.uri]) { // already have stuff to save -> no need to load
    // console.log(' (already started to person file) ' + doc)
  } else {
    try {
      console.log(' fetching person file: ' + doc)

      await fetcher.load(doc, clone(normalOptions)) // If exists, fine... leave it
    } catch (err) {
      if (err.response && err.response.status && err.response.status === 404) {
        console.log('No person file yet, creating ' + person)
        await saveUserData(fromUser, person) // Patch the file into existence
        peopleDone[person.uri] = true
        return person
      } else {
        console.log(' #### Error reading person file ' + err)
        console.log(' #### Error reading person file   ' + JSON.stringify(err))
        console.log('        err.response   ' + err.response)
        console.log('        err.response.status   ' + err.response.status)
        process.exit(8)
      }
    }
    peopleDone[person.uri] = true
  }
  return person
}
/**  Convert gitter message to Solid
 *
*/
// See https://developer.gitter.im/docs/messages-resource

var newMessages = 0
var oldMessages = 0

async function storeMessage (chatChannel, gitterMessage, archiveBaseURI) {
  var sent = new Date(gitterMessage.sent) // Like "2014-03-25T11:51:32.289Z"
  // console.log('        Message sent on date ' + sent)
  var chatDocument = chatDocumentFromDate(chatChannel, sent)
  var message = $rdf.sym(chatDocument.uri + '#' + gitterMessage.id) // like "53316dc47bfc1a000000000f"
  // console.log('          Solid Message  ' + message)

  await loadIfExists(chatDocument)
  if (store.holds(chatChannel, ns.wf('message'), message, chatDocument)) {
    // console.log(`  already got ${gitterMessage.sent} message ${message}`)
    oldMessages += 1
    return // alraedy got it
  }
  newMessages += 1
  console.log(`NOT got ${gitterMessage.sent} message ${message}`)

  var author = await authorFromGitter(gitterMessage.fromUser, archiveBaseURI)
  store.add(chatChannel, ns.wf('message'), message, chatDocument)
  store.add(message, ns.sioc('content'), gitterMessage.text, chatDocument)
  if (gitterMessage.html && gitterMessage.html !== gitterMessage.text) { // is it new information?
    store.add(message, ns.sioc('richContent'), gitterMessage.html, chatDocument) // @@ predicate??
  }
  store.add(message, ns.dct('created'), sent, chatDocument)
  if (gitterMessage.edited) {
    store.add(message, ns.dct('modified'), new Date(gitterMessage.edited), chatDocument)
  }
  store.add(message, ns.foaf('maker'), author, chatDocument)
  if (!toBePut[chatDocument.uri]) console.log('   Queueing to write  ' + chatDocument)
  toBePut[chatDocument.uri] = true
  return message
}

/** Update message friomn update operation
*
*
  Input payload Like   {"operation":"update","model":{
"id":"5c97d7ed5547f774485bbf05",
"text":"The quick red fox",
"html":"The quick red fox","sent":"2019-03-24T19:18:05.278Z","editedAt":"2019-03-24T19:18:12.757Z","fromUser":{"id":"54d26c98db8155e6700f7312","username":"timbl","displayName":"Tim Berners-Lee","url":"/timbl","avatarUrl":"https://avatars-02.gitter.im/gh/uv/4/timbl","avatarUrlSmall":"https://avatars2.githubusercontent.com/u/1254848?v=4&s=60","avatarUrlMedium":"https://avatars2.githubusercontent.com/u/1254848?v=4&s=128","v":30,"gv":"4"},"unread":true,"readBy":3,"urls":[],"mentions":[],"issues":[],"meta":[],"v":2}}
*/
async function updateMessage (chatChannel, payload) {
  var sent = new Date(payload.sent)
  var chatDocument = chatDocumentFromDate(chatChannel, sent)
  var message = $rdf.sym(chatDocument.uri + '#' + payload.id)
  await loadIfExists(chatDocument)
  var found = store.any(message, ns.sioc('content'))
  if (!found) {
    console.error('DID NOT FIND MESSAGE TO UPDATE ' + payload.id)
    return
  }

  console.log(`Updating  ${payload.sent} message ${message}`)

  var del = []
  var ins = []
  if (payload.text) {
    let oldText = kb.the(message, ns.sioc('content'))
    if (oldText && payload.text === oldText) {
      console.log(` text unchanged as <${oldText}>`)
    } else {
      del.push($rdf.st(message, ns.sioc('content'), oldText, chatDocument))
      ins.push($rdf.st(message, ns.sioc('content'), payload.text, chatDocument))
    }
  }
  if (payload.html) {
    let oldText = kb.the(message, ns.sioc('richContent'))
    if (oldText && payload.text === oldText.value) {
      console.log(` text unchanged as <${oldText}>`)
    } else {
      if (oldText) {
        del.push($rdf.st(message, ns.sioc('richContent'), oldText, chatDocument))
      }
      ins.push($rdf.st(message, ns.sioc('richContent'), payload.html, chatDocument))
    }
  }
  if (ins.length && payload.editedAt) {
    ins.push($rdf.st(message, ns.dct('modified'), new Date(payload.editedAt), chatDocument))
  }
  try {
    await updater.update(del, ins)
  } catch (err) {
    console.error('\n\nERROR UPDATING MESSAGE ' + err)
  }
}

async function deleteMessage (chatChannel, payload) {
  var chatDocument = chatDocumentFromDate(chatChannel, new Date()) // @@ guess now
  var message = $rdf.sym(chatDocument.uri + '#' + payload.id)
  await loadIfExists(chatDocument)
  var found = store.any(message, ns.sioc('content'))
  if (!found) {
    console.error('DID NOT FIND MESSAGE TO UPDATE ' + payload.id)
    return
  }
  console.log(`Deleting  ${payload.sent} message ${message}`)
  var del = store.connectedStatements(message)
  try {
    await updater.update(del, [])
  } catch (err) {
    console.error('\n\n Error deleting message: ' + err)
    return
  }
  console.log(' Deeleted OK.' + message)
}

/// /////////////////////////////  Do Room

async function doRoom (room, config) {
  console.log(`\nDoing room ${room.id}:  ${room.name}`)
  // console.log('@@ bare room: ' + JSON.stringify(room))
  var gitterRoom
  const solidChannel = chatChannelFromGitterRoom(room, config)
  const archiveBaseURI = archiveBaseURIFromGitterRoom(room, config)

  console.log('    solid channel ' + solidChannel)

  function findEarliestId (messages) {
    var sortMe = messages.map(gitterMessage => [gitterMessage.sent, gitterMessage])
    if (sortMe.length === 0) return null
    sortMe.sort()
    const earliest = sortMe[0][1]
    return earliest.id
  }

  async function show () {
    let name = room.oneToOne ? '@' + room.user.username : room.name
    console.log(`     ${room.githubType}: ${name}`)
  }

  async function details () {
    let name = room.oneToOne ? '@' + room.user.username : room.name
    console.log(`${room.githubType}: ${name}`)
    console.log(JSON.stringify(room))
  }

  async function catchup () {
    newMessages = 0
    oldMessages = 0
    gitterRoom = gitterRoom || await gitter.rooms.find(room.id)
    var messages = await gitterRoom.chatMessages()
    console.log(' messages ' + messages.length)
    for (let gitterMessage of messages) {
      await storeMessage(solidChannel, gitterMessage, archiveBaseURI)
    }
    await saveEverythingBack()
    if (oldMessages) {
      console.log('End catchup. Found message we already had.')
      return true
    }
    var newId = findEarliestId(messages)
    if (!newId) {
      console.log('Catchup found no gitter messages.')
      return true
    }
    for (let i = 0; i < 30; i++) {
      newId = await extendBeforeId(newId)
      if (!newId) {
        console.log(`End catchup. No more gitter messages after ${newMessages} new messages.`)
        return true
      }
      if (oldMessages) {
        console.log(`End catchup. Found message we already had, after ${newMessages} .`)
        return true
      }
      console.log(' ... pause ...')
      await delayMs(3000) // ms  give the API a rest
    }
    console.log(`FINISHED 30 CATCHUP SESSIONS. NOT DONE after ${newMessages} new messages `)
    return false
  }

  async function initialize () {
    const solidChannel = chatChannelFromGitterRoom(room, config)
    console.log('    solid channel ' + solidChannel)
    // Make the main chat channel file
    var newChatDoc = solidChannel.doc()
    let already = await loadIfExists(newChatDoc)
    if (!already) {
      store.add(solidChannel, ns.rdf('type'), ns.meeting('LongChat'), newChatDoc)
      store.add(solidChannel, ns.dc('title'), room.name + ' gitter chat archive', newChatDoc)
      await putResource(newChatDoc)
      console.log('    New chat channel created. ' + solidChannel)
      return false
    } else {
      console.log(`    Chat channel doc ${solidChannel}already existed: ✅`)
      return true
    }
  }

  async function extendArchiveBack () {
    let m0 = await firstMessage(solidChannel)
    let d0 = kb.anyValue(m0, ns.dct('created'))
    console.log('Before extension back, earliest message ' + d0)
    var newId = m0.uri.split('#')[1]
   // var newId = await extendBeforeId(id)
    for (let i = 0; i < 30; i++) {
      newId = await extendBeforeId(newId)
      if (!newId) return null
      console.log(' ... pause ...')
      await delayMs(3000) // ms  give the API a rest
    }
    return newId
  }

  async function stream (store) {
    gitterRoom = gitterRoom || await gitter.rooms.find(room.id)
    var events = gitterRoom.streaming().chatMessages()

   // The 'snapshot' event is emitted once, with the last messages in the room
    events.on('snapshot', function (snapshot) {
      console.log(snapshot.length + ' messages in the snapshot')
    })

   // The 'chatMessages' event is emitted on each new message
    events.on('chatMessages', async function (gitterEvent) {
      console.log('A gitterEvent was ' + gitterEvent.operation)
      console.log('Text: ', gitterEvent.model.text)
      console.log('gitterEvent object: ', JSON.stringify(gitterEvent))
      if (gitterEvent.operation === 'create') {
        var solidMessage = await storeMessage(solidChannel, gitterEvent.model, archiveBaseURI)
        console.log('creating solid message ' + solidMessage)
        var sts = store.connectedStatements(solidMessage)
        try {
          await updater.update([], sts)
          // await saveEverythingBack() // @@ change to patch as much more efficioent
          console.log(`Patched new message ${solidMessage} in `)
        } catch (err) {
          console.error(`Error saving new message ${solidMessage} ` + err)
          throw err
        }
      } else if (gitterEvent.operation === 'remove') {
        console.log('Deleting existing message:')
        await deleteMessage(solidChannel, gitterEvent.model)
      } else if (gitterEvent.operation === 'update') {
        console.log('Updating existing message:')
        await updateMessage(solidChannel, gitterEvent.model)
      } else if (gitterEvent.operation === 'patch') {
        console.log('Ignoring patch')
      } else {
        console.warn('Unhandled gitter event operation: ' + gitterEvent.operation)
      }
    })
    console.log('streaming ...')
  }

  /* Returns earliest id it finds so can be chained
  */
  async function extendBeforeId (id) {
    console.log(`   Looking for messages before ${id}`)
    gitterRoom = gitterRoom || await gitter.rooms.find(room.id)
    let messages = await gitterRoom.chatMessages({limit: 100, beforeId: id})
    console.log('      found ' + messages.length)
    if (messages.length === 0) {
      console.log('    END OF BACK FILL - UP TO DATE  ====== ')
      return null
    }
    for (let gitterMessage of messages) {
      await storeMessage(solidChannel, gitterMessage, archiveBaseURI)
    }
    await saveEverythingBack()
    let m1 = await firstMessage(solidChannel)
    let d1 = kb.anyValue(m1, ns.dct('created'))
    console.log('After extension back, earliest message now ' + d1)

    var sortMe = messages.map(gitterMessage => [gitterMessage.sent, gitterMessage])
    sortMe.sort()
    const earliest = sortMe[0][1]

    return earliest.id
  }
  async function create() {
    console.log('First make the solid chat object if necessary:')
    await initialize()
    console.log('Now first catchup  recent messages:')
    var catchupDone = await catchup()
    if (catchupDone) {
      console.log('Initial catchup gave no messages, so no archive necessary.✅')
      return null
    }
    console.log('Now extend the archive back hopefully all the way -- but check:')
    let pickUpFrom = await extendArchiveBack()
    if (pickUpFrom) {
      console.log('Did NOT go all the way.   More archive sessions will be needed. ⚠️')
    } else {
      console.log('Did go all the way. You have the whole archive to date. ✅')
    }
    return pickUpFrom
  }
  // Body of doRoom
  if (command === 'show') {
    await show()
  } else if (command === 'details') {
      await details()
  } else if (command === 'archive') {
    await extendArchiveBack()
  } else if (command === 'catchup') {
    await catchup()
  } else if (command === 'stream') {
    console.log('catching up to make sure we don\'t miss any when we stream')
    var ok = await catchup()
    if (!ok) {
      console.error('catching up FAILED so NOT starting stream as we would get a gap!')
      throw new Error('Not caught up. Cant stream.')
    }
    console.log('Catchup done. Now set up stream.')
    await stream(store)
  } else if (command === 'init') {
    var already = await initialize()
    // console.log('Solid channel already there:' + already)
  } else if (command === 'create') {
    await create()
  }
}

async function loadConfig () {
  console.log('Log into solid')
  var session = await auth.login({
    idp: process.env.SOLID_IDP,
    username: process.env.SOLID_USERNAME,
    password: process.env.SOLID_PASSWORD
  })
  var webId = session.webId
  const me = $rdf.sym(webId)
  console.log('Logged in to Solid as ' + me)
  var gitterConfig = {}

  await fetcher.load(me.doc())
  const prefs = kb.the(me, ns.space('preferencesFile'), null, me.doc())
  console.log('Loading prefs ' + prefs)
  await fetcher.load(prefs)
  console.log('Loaded prefs ✅')

  var config = kb.the(me, ns.solid('gitterConfiguationFile'), null, prefs)
  if (!config) {
    console.log('You don\'t have a gitter configuration. ')
    config = $rdf.sym(prefs.dir().uri + 'gitterConfiguration.ttl')
    if (await confirm('Make a gitter config file now in your pod at ' + config)) {
      console.log('    putting ' + config)
      await kb.fetcher.webOperation('PUT', config.uri, {data: '', contentType: 'text/turtle'})
      console.log('    getting ' + config)
      await kb.fetcher.load(config)
      await kb.updater.update([], [$rdf.st(me, ns.solid('gitterConfiguationFile'), config, prefs)])
      await kb.updater.update([], [$rdf.st(config, ns.dct('title'), 'My gitter config file', config)])
      console.log('Made new gitter config: ' + config)
    } else {
      console.log('Ok, exiting, no gitter config')
      process.exit(4)
    }
  } else {
    await fetcher.load(config)
  }
  console.log('Have gitter config ✅')

  for (var opt of opts) {
    var x = kb.anyValue(me, ns.solid(opt))
    console.log(` Config option ${opt}: "${x}"`)
    if (x) {
      gitterConfig[opt] = x.trim()
    } else {
      console.log('\nThis must a a full https: URI ending in a slash, which folder on your pod you want gitter chat stored.')
      x = await question('Value for ' + opt + '?')
      if (x.length > 0 && x.endsWith('/')) {
        await kb.updater.update([], [$rdf.st(me, ns.solid(opt), x, config)])
        console.log(`saved config ${opt} =  ${x}`)
      } else {
        console.log('abort. exit.')
        process.exit(6)
      }
    }
    gitterConfig[opt] = x
  }
  console.log('We have all config data ✅')
  return gitterConfig
}

/******************************* MAIN PROGRAM BODY
*/
async function go () {
  /*
  console.log('Getting orgs .')
  const orgs = await octokit.orgs.list()
  console.log('orgs: ' + orgs.length)
  */
  var owner = 'solid'
  var repo = 'mashlib'


  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner, repo,
  })
  console.log(`Issues for ${owner}/${repo}: ${issues.length}`)
  for (var iss of issues) {
    console.log('Issue: ' + JSON.stringify(iss, null, 4))
  }

  var orgProjects = []
  try {
    orgProjects = await octokit.paginate(octokit.projects.listForOrg, {
      owner,
    })
  } catch (err) {
    console.error('listForOrg: ' + err)
  }
  console.log(`orgProjects ${orgProjects.length}`)

  var repoProjects = []
  try {
    repoProjects = await octokit.paginate(octokit.projects.listForRepo, { owner, repo, })
  } catch (err) {
    console.error('listForRepo: ' + err)
  }


  console.log(`repoProjects ${repoProjects.length}`)

  //   try {} catch (err) {console.error('listForOrg: ' + err)}
  //   try {} catch (err) {console.error('listForOrg: ' + err)}
  //   try {} catch (err) {console.error('listForOrg: ' + err)}

  // await saveEverythingBack()
  console.log('ENDS')
  process.exit(0)

} // go

var toBePut = []
var peopleDone = {}
const opts = ['individualChatBaseURI', 'privateChatBaseURI', 'publicChatBaseURI']
go()

// ends
