import org.codehaus.groovy.control.CompilerConfiguration
abstract class CallMeEnrollmentStub extends Script {
  def methodMissing(String name, Object arguments) {
    def a = arguments as Object[]
    if (name == 'when' || name == 'withCredentials') throw new RuntimeException('forbidden step')
    if(name == 'timeout') calls << [timeout:a[0], inside:inside]
    if(a && a[-1] instanceof Closure) return a[-1].call()
  }
  def deleteDir() { assert !inside; calls << [event:'cleanup'] }
  def checkout(Object spec) { assert !inside; calls << [event:'checkout',spec:spec]; [GIT_COMMIT:metadata] }
  def sh(Object command) {
    if(command instanceof Map) {
      if(command.script.startsWith('test')) return '1000:1000'
      calls << [event: inside ? 'container-sha' : 'host-sha']
      return inside ? (currentImage.startsWith('oven/') ? bunSha : containerSha) : actual
    }
    calls << [command:command,inside:inside]
    if(failChecks && command.contains('node --test')) throw new RuntimeException('checks failed')
    if(failBuild && command.contains('test-only-server.sh')) throw new RuntimeException('compile failed')
  }
  def error(String message) { throw new RuntimeException(message) }
  def echo(String message) { calls << [success:message] }
}
def sha='a'*40
def file=new File(args ? args[0] : 'Jenkinsfile.ci-enrollment')
def runCase={ Map overrides ->
 def s=[params:[EXPECTED_SHA:sha,TEST_ONLY:true], scm:[branches:[[name:sha]],userRemoteConfigs:[[url:'https://example.invalid/repo.git',credentialsId:'read-only']]], calls:[],inside:false,metadata:sha,actual:sha,containerSha:sha,bunSha:sha,currentImage:'',failChecks:false,failBuild:false]+overrides
 s.docker=[image:{String image ->
   assert image in ['node:22-bookworm','oven/bun:1.3.3-debian']
   [inside:{String options,Closure body ->
     assert options=='--user 1000:1000';s.calls << [event:'container-start'];s.inside=true;s.currentImage=image
     try {body()} finally {s.inside=false;s.calls << [event:'container-exit']}
   }]
 }]
 String failure=null
 try {new GroovyShell(this.class.classLoader,new Binding(s),new CompilerConfiguration(scriptBaseClass:CallMeEnrollmentStub.name)).evaluate(file)}
 catch(RuntimeException e){failure=e.message}
 [calls:s.calls,failure:failure]
}
def good=runCase([:]);assert good.failure==null
assert good.calls.findAll{it.event}.collect{it.event}==['cleanup','checkout','host-sha','container-start','container-sha','container-exit','container-start','container-sha','container-exit','cleanup']
assert good.calls.find{it.spec}.spec.branches==[[name:'refs/remotes/origin/ci-expected']]
assert good.calls.find{it.spec}.spec.userRemoteConfigs[0].refspec=="+${sha}:refs/remotes/origin/ci-expected"
assert good.calls.find{it.timeout?.time==1 && it.inside}
assert good.calls.find{it.command?.contains('env -i PATH="$PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test')}
assert good.calls.find{it.command?.contains('env -i PATH="$PATH" sh scripts/ci/test-only-server.sh')}
int cases=1
for(o in [[params:[EXPECTED_SHA:sha,TEST_ONLY:false]],[params:[EXPECTED_SHA:'',TEST_ONLY:true]],[params:[EXPECTED_SHA:'main',TEST_ONLY:true]],[scm:[branches:[[name:'*/main']]]],[scm:[branches:[[name:sha],[name:'*/main']]]],[metadata:'b'*40],[actual:'b'*40],[containerSha:'b'*40],[bunSha:'b'*40],[failChecks:true],[failBuild:true]]) {
 def r=runCase(o);assert r.failure;assert !r.calls.any{it.success}
 if(o.failBuild || o.containerSha || o.bunSha) assert r.calls.takeRight(2).collect{it.event}==['container-exit','cleanup']
 cases++
}
println "PASS: ${cases} actual CallMe enrollment pipeline cases"

