# How to Select Your Scout Deployment

When implementing observability with Scout, one of the key decisions you'll
face is how to deploy your telemetry collection infrastructure.

Scout uses OpenTelemetry (OTel) collectors to gather and export signals
(traces, metrics, and logs) to the Scout platform.

This guide will help you
understand from simplest including no collector and agent collector to most complex
including gateway collector deployment strategies and
choose the right approach for your setup.

## Deployment Strategies

There are three main patterns for deploying Scout collectors in your environment:

1. **No Collector** - Applications send telemetry directly to Scout
(No Scout Collector involved)
2. **Agent Deployment** - Scout collector runs alongside your applications
3. **Gateway Deployment** - Centralized Scout collectors aggregate telemetry from
 multiple applications/collectors

Each strategy has advantages and trade-offs. The right choice depends on your
architecture, scale, operational requirements, and specific use cases.

## No-Collector Deployment Pattern

The simplest approach is to skip collectors entirely and have your applications
send telemetry signals directly to Scout using the OpenTelemetry Protocol (OTLP).

### How It Works

In this pattern, applications instrumented with OpenTelemetry SDKs export traces,
metrics, and logs directly to Scout's OTLP endpoint. There's no intermediate
processing or collection layer.

![No Collector](/img/no-collector.svg)

### When to Use No-Collector

This pattern works well in several scenarios:

**Serverless Environments**: Lambda functions or other serverless workloads benefit
from this approach since they have no infrastructure management requirements.

**Simple Applications**: Small applications or services that don't require data
transformation or processing.

**Development and Testing**: When you want to quickly instrument an application
for debugging or testing without setting up additional infrastructure for Scout collectors.

### Advantages

- **Minimal Complexity**: No additional infrastructure to deploy, configure, or maintain
- **Quick Setup**: Fastest way to start sending telemetry to Scout
- **Low Resource Overhead**: No collector processes consuming CPU or memory

### Limitations

- **Limited Processing**: No filtering or transforming telemetry data
- **Network Dependencies**: If Scout becomes unreachable, your application may
experience issues
- **Configuration Changes**: Modifying telemetry configuration requires code
changes and redeployments that is often less convenient than what’s needed to
change a collector configuration.

### When Not to Use

Avoid this pattern if you need data transformation, have high reliability requirements.

> For more details on [no-collector pattern deployment](https://docs.base14.io/instrument/collector-setup/sending-telemetry-directly-to-scout-backend).

## Agent Collector Deployment Pattern

In agent deployment, a Scout collector instance is deployed close to your
application typically on the same host, in the same pod, or as a sidecar container.

### How It Works

Applications send telemetry to a Scout collector, which then processes data
 and forwards it to Scout. The collector acts as a local buffer and processing layer.

![Agent Collector](/img/agent-collector.svg)

### When to Use Agent Deployment

This is the most common and recommended pattern for most production environments:

**Production Applications**: When you need reliable telemetry collection with
local buffering and processing capabilities.

**Containerized Environments**: Docker containers, Kubernetes pods, or ECS tasks
where you can deploy collectors as sidecars or daemonsets.

**Virtual Machines**: Traditional VM-based deployments where you can install
 collectors on each host.

The purpose of the close placement of collector to application is to offload
telemetry data quickly and efficiently from the application to minimize
interruption.  

### Advantages

- **Local Buffering**: Collector provides temporary storage if Scout becomes
 temporarily unreachable
- **Data Processing**: Ability to filter, enrich, and transform telemetry before
sending to Scout
- **Decoupled Applications**: Application only need to know about the local collector,
not Scout directly
- **Flexible Configuration**: Change telemetry configurations without modifying
application code, hence no need to redeploy application unlike no-collector pattern

### Configuration Flexibility

With agent deployment, you can easily:

- Add environment labels to all telemetry from a specific host
- Filter out sensitive information before it leaves your infrastructure  
- Perform data processing before sending to Scout
- Implement retry logic and error handling

### Limitations

- **Doesn't scale well** – If you have lots of agent collectors running
 on different machines, making sure they all use the same rules (like adding
 resource labels,hiding sensitive data, or routing to the right place) is tricky
 and easy to mess up.

- **Can't see the full trace** – Some features, like [tail-based sampling](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor),
 need to look at a whole trace before deciding what to keep.
But if parts of that trace are spread across multiple agents, you never get the
full trace and tail-based sampling is not possible.

### When Not to Use

- **Tail-based sampling**: When you need the full trace across all services.
 The gateway pattern is more suitable for this.

- **Centralized policies**: like redacting sensitive data once in one place, or
enforcing egress rules (e.g., all traffic goes through a secure gateway).

## Gateway Collector Deployment Pattern

Gateway deployment introduces a second tier of collection where multiple agent
collectors or applications send telemetry to centralized OTLP endpoint provided
by one or more Scout collector instances running as a standalone service.

### How It Works

This pattern typically combines agent collectors with gateway collectors.
Applications send data to local agent collectors which forward it to centralized
gateway collectors for additional processing before sending to Scout.
![Gateway Collector](/img/gateway-collector.svg)

The previous diagram is simplified because it shows an architecture with only a
single gateway collector instance. More often, multiple gateway collector instances
are deployed together with a load balancer, as shown in the following diagram:

![Gateway Collector Load Balancer](/img/gateway-collector-load-balancer.svg)

### Load Balancer Benefits

- **Scalability**: Scale gateway instances based on traffic demands
- **High Availability**: Multiple collector instances prevent single points of failure

### When to Use Gateway Deployment

A gateway setup makes sense when you need one central place to handle telemetry
before it goes to Scout. For example:

- **Same processing rules everywhere** : you want all services to follow the same
redaction, enrichment, or routing policies.
- **Network restrictions** : applications can't talk to the internet directly,
so they send data to the gateway, which forwards it securely.  
- **Advanced features** : tail-based sampling or batching require all data in
one place.
- **Easier operations** : instead of updating configs across dozens of agents,
you manage them once at the gateway.

### Advanced Features Enabled by Gateway Deployment

**Tail-Based Sampling**: Make intelligent sampling decisions based on complete
traces rather than individual spans. This requires all spans from a trace to be
processed by the same collector instance. It uses a load-balancing exporter to
ensure all spans from a trace reach the same gateway collector.
> Read more about [tail-based sampling](https://opentelemetry.io/docs/collector/deployment/gateway/).

### Advantages

- **Centralized Control**: Single point for implementing organization-wide
telemetry policies
- **Scalability**: Can handle high-volume telemetry from large environments
- **Security Benefits**: Centralized point for data inspection and security controls
- **Cost Optimization**: Better control over data volume and sampling before egress

### Limitations

- **Increased Complexity**: More infrastructure components to deploy and maintain
- **Additional Latency**: Extra network hop between agent and gateway collectors
- **Higher Resource Requirements**: Gateway collectors need significant resources
 for processing large data volumes

### When Not to Use

- Avoid gateway deployment for simple environments where agent collectors meet your
needs, or  when  complex processing is not required.

- When you want to capture Host-level metrics like CPU, memory,
or disk stats of a machine,
for which the collector must run on that machine (as an agent).
- When you want to capture Kubernetes metadata using processors like
k8sattributes or resourcedetection
which work best when they run on the node or pod where the app is running,
not in a central gateway.

### Environment-Specific Recommendations

**Kubernetes Environments**:

- Start with Agent deployment using DaemonSets or Sidecar containers
(for fargate nodes)
- Add Gateway deployment as you scale beyond 50-100 services

**Traditional VMs/Bare Metal**:

- Deploy Scout collectors as agents on each host
- Consider Gateway deployment for centralized policy management

**Cloud-Native/Serverless**:

- No-Collector for simple Lambda functions

## Conclusion

Selecting the right Scout collector deployment strategy is crucial for building
a reliable, scalable observability infrastructure. Start with the simplest approach
that meets your current needs, but plan for future growth and complexity.

Remember that these patterns can be combined - you might use no-collector deployment
 for some simple services while implementing gateway deployment for your core business
 applications.The key is to match your deployment strategy to your specific requirements,
   operational capabilities, and scale.

For detailed configuration examples and Scout-specific setup instructions, refer
 to the [Scout Collector Setup Documentation](https://docs.base14.io/category/opentelemetry-collector-setup).

Whether you're instrumenting your first application or scaling to thousands of
services, the right deployment strategy will provide the foundation for
 comprehensive observability with Scout.
